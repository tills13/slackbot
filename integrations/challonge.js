var request = require('request');
var _ = require('underscore');
var config = require('../config/challonge');

var ChallongeIntegration = function(context) {
    this.context = context;
    this.slack = context.slack;
    this.logger = context.logger;
    this.name = 'CHALLONGE';

    this.slack.on('message', this.onMessage.bind(this));

    this.activeMatches = [];
    this.completedMatches = [];
    this.tournaments = null;
    this.tournament = null;
    this.userMap = {};

    this.config = config;
    this.isUpdating = false;
    this.updateWorker = setInterval(this.update.bind(this), this.config.updateFrequency);
    this.slackWorker = setInterval(this.updateSlack.bind(this), this.config.updateSlackFrequency || this.config.updateFrequency);
}

ChallongeIntegration.prototype = {
    onMessage: function(message) {
        var channel = this.slack.getChannelGroupOrDMByID(message.channel);
        var user = this.slack.getUserByID(message.user);
        var text = message.text;

        if (name = text.match(/claim ([^ ]+)/)) {
            this.userMap[name[1]] = "@{0}".format(user.name);
            channel.send("cool, you're now linked to {0}".format(name[1]));
            console.log(this.userMap);
        }
    },

    init: function() {},

    update: function() {
        if (!this.context.ready || this.isUpdating) return; // make sure we're connected to slack
        if (!this.tournaments) this.fetchTournaments();
        else this.updateTournament();
    },

    fetchTournaments: function(callback) {
        this.isUpdating = true;

        var date = new Date();
        var options =  {
            method: 'GET',
            uri: this.getUri('tournaments', [], {
                //created_before: "{0}-{1}-{2}".format(date.getFullYear(), (date.getMonth() + 1), date.getDate() + 1),
                //created_after: "{0}-{1}-{2}".format(date.getFullYear(), (date.getMonth() + 1), date.getDate() - 1) // nope
                //subdomain: 'rbm'
            }),
            baseUrl: this.config.api.host,
            json: true
        };

        var req = request(options, function(error, response, body) {
            try {
                if (error) {
                    throw "something went wrong fetching tournaments";
                } else {
                    if (body.length == 0) {
                        throw "no tournaments found";
                    } else {
                        this.tournaments = body;
                    }
                }

                if (this.tournaments) this.logger.info("found {0} tournaments: {1}".format(
                    this.tournaments.length,
                    _.map(this.tournaments, function(tournament) {
                        return tournament.tournament.url;
                    }).join(',')
                ));
            } catch (e) { this.logger.error("{0}, retrying in {1} second(s)".format(e.message, (this.config.updateFrequency/1000))); }

            this.isUpdating = false;
        }.bind(this));
    },

    updateTournament: function() {
        this.isUpdating = true;
        
        var tournamentId = (this.tournament || this.tournaments[this.tournaments.length - 1].tournament).url;

        var options =  {
            method: 'GET',
            uri: this.getUri('tournament', [tournamentId], {
                include_matches: 1,
                include_participants: 1
            }),
            baseUrl: this.config.api.host,
            json: true
        };

        var req = request(options, function(error, response, body) {
            if (error) {
                this.logger.error("something went wrong updating tournament");
            } else {
                this.tournament = body.tournament;
                this.logger.info("updated tournament: {0}".format(this.tournament.url));
            }

            this.isUpdating = false;
        }.bind(this));
    },

    updateSlack: function() {
        if (!this.context.ready || !this.tournament) return;

        // todo multiple channels?
        var channel = this.slack.getChannelByName(this.config.channel);
        var messages = [];

        if (!channel) {
            this.logger.error("{0} is not a valid channel".format(this.config.channel));
            return;
        }

        if (!this.hasNotifiedOpenTourney && 
             this.tournament.state == 'pending' || 
             this.tournament.state == 'open') {
            //messages.push("Tournament *{0}* now open for signup: {1}".format(this.tournament.name, (this.tournament.sign_up_url || this.tournament.full_challonge_url)));
            this.hasNotifiedOpenTourney = true;
        }

        if (!this.hasNotifiedUnderwayTourney && this.tournament.state == 'underway') {
            channel.send("*Tournament `{0}` is underway*: _Follow along at_ {1}\n>>>{2} *Participants Signed Up:*\n_{3}_".format(
                this.tournament.name,
                this.tournament.full_challonge_url,
                this.tournament.participants.length,
                _.map((this.tournament.participants || []), function(participant) {
                    participant = participant.participant; // why
                    return this.getParticipantName(participant.name);
                }.bind(this)).join('_, _')
            ));
            //messages.push("Tournament *{0}* is underway: {1}".format(this.tournament.name, this.tournament.full_challonge_url));
            this.hasNotifiedUnderwayTourney = true;
        }

        if (this.context.config.debug) {
            console.log("active matches: [{0}]".format(this.activeMatches.join(',')));
            console.log("complete matches: [{0}]".format(this.completedMatches.join(',')));
        }

        var availableMatches = [];
        for (var index = 0; index < (this.tournament.matches || []).length; index++) {
            var match = this.tournament.matches[index].match;
            if (this.context.config.debug) console.log(match.id, match.state, match.scores_csv);

            if (match.state == 'open' && this.activeMatches.indexOf(match.id) == -1) {
                // assume active because we don't actually track 
                // state other than 'open' and 'complete' 
                this.activeMatches.push(match.id); 
                availableMatches.push(match);
                /*messages.push("> Available match between {0} and {1}".format(
                    this.getParticipant(match.player1_id).name, 
                    this.getParticipant(match.player2_id).name
                ));*/
            }

            if (match.state == 'complete') { // completed
                if (this.completedMatches.indexOf(match.id) == -1) {
                    this.completedMatches.push(match.id);
                } else continue;

                if (this.activeMatches.indexOf(match.id) != -1) { // recently won
                    messages.push("> :tada: Congrats *{0}* for beating *{1}* `{2}`".format(
                        this.getParticipantName(this.getParticipant(match.winner_id)), 
                        this.getParticipantName(this.getParticipant(match.loser_id)),
                        match.scores_csv
                    ));

                    delete this.activeMatches[match.id];
                } else { // in case we get to this point and the match is already complete
                    messages.push("> :tada: Belated congrats *{0}* for beating *{1}* `{2}`".format(
                        this.getParticipantName(this.getParticipant(match.winner_id)),
                        this.getParticipantName(this.getParticipant(match.loser_id)),
                        match.scores_csv
                    ));
                }
            }
        }

        for (var index = 0; index < (this.tournament.participants || []).length; index++) {
            var participant = this.tournament.participants[index].participant;
            var name = participant.name;

            if (this.userMap[name] == undefined) {
                this.userMap[name] = name;
            }
        }

        // make it so only if different do you show the alias
        for (var i = 0; i < availableMatches.length; i++) {
            var match = availableMatches[i];
            availableMatches[i] = "{0}: {1} ({3}) vs. {2} ({4})".format(
                (i + 1), 
                this.getParticipantName(this.getParticipant(match.player1_id)), 
                this.getParticipantName(this.getParticipant(match.player2_id)),
                this.getParticipant(match.player1_id).name, 
                this.getParticipant(match.player2_id).name
            );
        }

        if (messages.length != 0) {
            //channel.send("{0}".format(messages.join('\n')));        
        }

        if (availableMatches.length != 0) {
            //channel.send("*Active or Available Matches*\n>>>{0}".format(availableMatches.join('\n')));  
        }
    },

    getUri: function(component, format, params) {
        var partial = this.config.api[component].format(format);

        var attributes = [];
        var keys = Object.keys(params);
        for (var index = 0; index < Object.keys(params).length; index++) {
            var key = keys[index];
            attributes.push("{0}={1}".format(key, params[key]));
        }

        if (params['api_key'] == undefined) {
            attributes.push("{0}={1}".format('api_key', process.env.CHALLONGE_TOKEN));
        }

        return "{0}?{1}".format(partial, attributes.join('&'));
    },

    getMatch: function(id) {
        for (i = 0; i < this.tournament.matches.length; i++) {
            var match = this.tournament.matches[i].match;
            if (match.id == id) return match;
        }
    },

    getParticipant: function(id) {
        for (i = 0; i < this.tournament.participants.length; i++) {
            var participant = this.tournament.participants[i].participant;
            if (participant.id == id) return participant;
        }
    },

    getParticipantName: function(participant) {
        // the participant object
        if (typeof participant == 'object') {
            if (participant.participant) participant = participant.participant;
            return (this.userMap[participant.name] || participant.name);
        } else return (this.userMap[participant] || participant);
    }
}

module.exports = ChallongeIntegration;