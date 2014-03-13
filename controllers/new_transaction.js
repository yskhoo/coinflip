var async = require('async');
var _ = require('underscore');
var graph = require('fbgraph');
var coinbase_api = require('./coinbase_api.js');

function xinspect(o,i){
    if(typeof i=='undefined')i='';
    if(i.length>50)return '[MAX ITERATIONS]';
    var r=[];
    for(var p in o){
        var t=typeof o[p];
        r.push(i+'"'+p+'" ('+t+') => '+(t=='object' ? 'object:'+xinspect(o[p],i+'  ') : o[p]+''));
    }
    return r.join(i+'\n');
}

/**
 * GET /new_transaction
 * New transaction form page.
 */
exports.getNewTransaction = function(req, res, next) {
  var token = _.findWhere(req.user.tokens, { kind: 'facebook' });
  graph.setAccessToken(token.accessToken);
  // TODO: Filter out friends that do not match a user in DB
  async.parallel(
    {
      getMyFriends: function(done) {
        graph.get(req.user.facebook + '/friends', function(err, friends) {
          done(err, friends.data);
        });
      },
      // TODO: Exchange rates update once a minute. Reflect actual amount at that frequency.
      getExchangeRates: function(done) {
        coinbase_api.getExchangeRates({}, done);
      },
      userBalance: function(done) {
        coinbase_api.getBalance({user: req.user}, done);
      }
    },
    function(err, results) {
      if (err) {
        return next(err);
      }
      var friends = results.getMyFriends;
      var exchangeRates = _.pick(JSON.parse(results.getExchangeRates), 'usd_to_btc');
      var friendsJson = [];

      _.each(friends, function(friend) {
        friendsJson.push( { name : friend.name } );
      });

      var balance_amount;
      var balance_currency = '';
      var balance_result;
      try {
        balance_result = JSON.parse(results.userBalance);
        balance_amount = balance_result.amount;
        balance_currency = balance_result.currency;
      } catch (err) {
        // json parse can fail when access token is invalid
        // need to start using refresh tokens to genereate new access tokens
        balance_amount = "error parsing coinbase json";
      }

      res.render('new_transaction', {
        controllerJs: 'new_transaction',
        title: 'New Transaction',
        balance_amount: balance_amount,
        balance_currency: balance_currency,
        dump: {
          friends: friendsJson,
          rates: exchangeRates
        }
      });
    }
  );
};

/**
 * POST /new_transaction
 * Pay or charge a friend in either BTC or USD.
 * @param name
 * @param amount
 * @param message
 */

exports.postNewTransaction = function(req, res) {
  req.assert('name', 'Who is your friend?').notEmpty();
  req.assert('amount', 'How much?').notEmpty();
  req.assert('notes', 'Leave a note for your friend.').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    req.flash('errors', errors);
    return res.redirect('/new_transaction');
  }

  var name = req.body.name;
  var amount = req.body.amount;
  var notes = req.body.notes;
  var sendMoneyOptions = {
    "user" : req.user,
    "transaction": {
      "to": name,
      "amount": amount,
      "notes": notes
    }
  };

  async.parallel(
    {
      sendMoney: function(done) {
        coinbase_api.sendMoney(sendMoneyOptions, done);
      }
    },
    function(err, results) {
      if (err) {
        req.flash('errors', err);
        return res.redirect('/new_transaction');
      }
      // TODO: Implement dynamic success message.
      req.flash('success', {msg: xinspect(results)});//{ msg: 'Successfully paid '+name+' '+amount+' BTC/USD!'});
      res.redirect('/new_transaction');
    }
  );
};
