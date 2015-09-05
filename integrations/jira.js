var request = require('request');
var config = require('../config/jira');

var JiraIntegration = function(context) {
    this.slack = context.slack;
    this.logger = context.logger;
    this.name = 'JIRA';
    this.recentIssues = [];

    this.slack.on('message', this.onMessage.bind(this));

    this.config = config;
}

JiraIntegration.prototype = {
    start: function() {},
    stop: function() {},

    onMessage: function(message) {
        var channel = this.slack.getChannelGroupOrDMByID(message.channel);
        var user = this.slack.getUserByID(message.user);
        var text = message.text;

        regex = new RegExp('((?:' + this.config.projects.join('|') + ')(?:-| )?\\d+)', 'ig');

        if (issues = text.match(regex)) {
            this.logger.info("found {0} in {1}'s comment".format(issues.join(','), user.name));
            this.fetchJiraInfo(issues, function(completed, failed, skipped) {
                var responses = [];

                for (var i = 0; i < completed.length; i++) {
                    var issue = completed[i];

                    var summary = issue.fields.summary || 'no summary';
                    var description = issue.fields.description.trim('\n') || 'no description';
                    var assignee = issue.fields.assignee;
                    var status = issue.fields.status;

                    var description = description.split('\n').join('\n>');

                    var finalDescription = description.substring(0, Math.min(200, description.length));
                    if (finalDescription.length != description.length) finalDescription += '...';

                    responses.push("`{0}`: {1}\n{5}\n>{2}\n\n\n*Assigned to*: {3}\t*Status*: {4}".format(
                        issue.key,
                        summary,
                        finalDescription,
                        assignee ? assignee.displayName : 'Not assigned',
                        status.name,
                        this.config.host.format(issue.key)
                    ));
                }

                var extra = null;
                if (failed.length != 0) {
                    extra = "could not find info for [*{0}*]".format(failed.join('*,* '));
                }

                if (skipped.length != 0) {
                    if (extra) extra += '\n';
                    else extra = '';

                    extra += "skipped [*{0}*]".format(skipped.join('*,* '));
                }

                if (extra) responses.push(extra);
                
                channel.send(responses.join('\n----------------------------------------------------\n'));
            }.bind(this));
        }
    },

    fetchJiraInfo: function(issues, callback) {
        var completedIssues = [];
        var failedIssues = [];
        var skippedIssues = [];
        var cooldown = 1000 * 60 * 5; // five minutes

        var options =  {
            uri: null,
            baseUrl: this.config.api.host,
            auth: {
                user: this.config.username,
                pass: this.config.password
            }
        };

        for (var i = 0; i < issues.length; i++) {
            var issue = issues[i];

            if (Object.keys(this.recentIssues).indexOf(issue) != -1) {
                if (this.recentIssues[issue] > (new Date()).getTime() - (cooldown)) {
                    this.logger.info("requested {0} but it's only been {1}/{2} seconds".format(issue,Math.round(((new Date()).getTime() - this.recentIssues[issue])/1000),Math.round(cooldown/1000)));
                    skippedIssues.push(issue);
                    continue; 
                }

                delete this.recentIssues[issue];
            } else {
                this.recentIssues[issue] = (new Date()).getTime();
            }

            options.uri = (this.config.api.issue + issue);

            if (options.uri) {
                var req = request(options, function(error, response, body) {
                    if (!error && response.statusCode == 200) completedIssues.push(JSON.parse(body));
                    else failedIssues.push(issue);

                    if ((completedIssues.length + failedIssues.length + skippedIssues.length) == issues.length && callback) {
                        callback(completedIssues, failedIssues, skippedIssues);
                    }
                }.bind(this));
            } else {
                this.logger.info("unknown uri for {0}".format(issue));
            }
        }
    }
}

module.exports = JiraIntegration;