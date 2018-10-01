var ccxt = require('ccxt');
var _ = require('lodash');
var moment = require('moment');

const util = require('../core/util');
const Errors = require('../core/error');
const log = require('../core/log');

const BATCH_SIZE = 100;

var Trader = function(config) {
  _.bindAll(this);

  this.post_only = true;
  this.use_sandbox = false;
  this.name = 'Cryptopia';
  this.scanback = false;
  this.scanbackTid = 0;
  this.scanbackResults = [];
  this.asset = config.asset;
  this.currency = config.currency;

  if (_.isObject(config)) {
    this.key = config.key;
    this.secret = config.secret;

    this.pair = [config.asset, config.currency].join('-').toUpperCase();
    this.post_only =
      typeof config.post_only !== 'undefined' ? config.post_only : true;
  }

  this.public = new ccxt.cryptopia();
  this.private = new ccxt.cryptopia({
    key: this.key,
    secret: this.secret,
  });
};

var retryCritical = {
  retries: 10,
  factor: 1.2,
  minTimeout: 10 * 1000,
  maxTimeout: 60 * 1000,
};

var retryForever = {
  forever: true,
  factor: 1.2,
  minTimeout: 10 * 1000,
  maxTimeout: 300 * 1000,
};

// Probably we need to update these string
var recoverableErrors = new RegExp(
  /(SOCKETTIMEDOUT|TIMEDOUT|CONNRESET|CONNREFUSED|NOTFOUND|Rate limit exceeded|Response code 5)/
);

Trader.prototype.getPortfolio = function(callback) {
  this.private.getBalance()
    .then(balances => this.mapBalances)
    .then(balances => callback(null, balances))
    .catch(err => callback(err, null));
};

Trader.prototype.mapBalances = function (balances) {
  return Object.keys(balances).map((balance) => {
    return {
      name: balance,
      amount: balances[balance].total
    }
  })
}

Trader.prototype.getTicker = function(callback) {
  this.public.fetchTicker(this.pair).then(ticker => {
    callback(null, { bid: ticker.bid, ask: ticker.ask })
  })
  .catch(err => callback(err, null));
};

Trader.prototype.getFee = function(callback) {
  return  callback(null, 0.0002);
};

Trader.prototype.buy = function(amount, price, callback) {
  this.private.createLimitBuyOrder(this.transformPair(), amount, price)
    .then(order => callback(null, order))
    .catch(err => {
      util.retryCustom(retryCritical, this.buy.apply(this, arguments), callback);
    });
};

Trader.prototype.sell = function(amount, price, callback) {
  this.private.createLimitSellOrder(this.transformPair(), amount, price)
    .then(order => callback(null, order))
    .catch(err => {
      util.retryCustom(retryCritical, this.buy.apply(this, arguments), callback);
    });
};

Trader.prototype.checkOrder = function(order, callback) {
  this.private.fetchOrder(order.id)
    .then(order => callback(null, order.status === "closed" && order.remaining === 0 ? true : false))
    .catch(err => {
      util.retryCustom(retryCritical, this.buy.apply(this, arguments), callback);
    });
};

Trader.prototype.getOrder = function(order, callback) {
  this.private.fetchOrder(order.id)
    .then(order => callback(null, { price: order.price, amount: order.amount, date: moment.unix(order.timestamp) }))
    .catch(err => {
      util.retryCustom(retryCritical, this.buy.apply(this, arguments), callback);
    });
};

Trader.prototype.cancelOrder = function(order, callback) {
  this.private.cancelOrder(order.id)
    .then(order => callback(null))
    .catch(err => {
      util.retryCustom(retryCritical, this.buy.apply(this, arguments), callback);
    });
};

Trader.prototype.transformPair = function () {
  return this.pair.replace("-", "/");
};

Trader.prototype.getTrades = function(since, callback, descending) {

  this.public.fetchTrades(this.transformPair())
    .then(trades => {
      return trades.map((trade) => {
        return {
          date: trade.timestamp / 1000,
          price: trade.price,
          amount: trade.amount,
          tid: trade.timestamp + trade.price + trade.amount,
        }
      });
    })
    .then(trades => {
      callback(null, descending ? trades : trades.reverse())
    })
    .catch(err => {
      callback(err, null);
    });
};

Trader.getCapabilities = function() {
  return {
    name: 'Cryptopia',
    slug: 'cryptopia',
    currencies: ['BTC'],
    assets: ['ETN', 'LINDA', 'PRL', 'WSX'],
    markets: [
      { pair: ['BTC', 'ETN'], minimalOrder: { amount: 0.00000001, unit: 'asset' } },
      { pair: ['BTC', 'LINDA'], minimalOrder: { amount: 0.00000001, unit: 'asset' } },
      { pair: ['BTC', 'PRL'], minimalOrder: { amount: 0.00000001, unit: 'asset' } },
      { pair: ['BTC', 'WSX'], minimalOrder: { amount: 0.00000001, unit: 'asset' } },
    ],
    requires: ['key', 'secret'],
    tid: 'date',
    tradable: true,
    fetchTimespan: 60,
    providesHistory: "date",
  };
};

module.exports = Trader;
