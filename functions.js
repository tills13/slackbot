String.prototype.format = function() {
    var formatted = this;
    for (var arg in arguments) {
    	while (formatted.indexOf("{" + arg + "}") != -1) {
    		formatted = formatted.replace("{" + arg + "}", arguments[arg]);
    	}
    }

    return formatted;
}