'use strict';

// native modules
const fs = require('fs');

// 3rd party modules
const Express = require('express');
const logger = require('winston');
const SocketIO = require('socket.io');

// application modules
const express = require('./express');
const Server = require('./server');
const nconf = require('../config');
const eventBus = require('./tools/eventBus');
const models = require('./models');
const routes = require('./routes');
const AddonManager = require('./addons');
const DB = require('./db');

if (nconf.get('help') || nconf.get('h')) {
  nconf.stores.argv.showHelp();
  process.exit(0);
}

// Defines
const https = nconf.get('https'),
    listen = nconf.get('listen'),
    port = nconf.get('port'),
    verbose = nconf.get('verbose'),
    silent = nconf.get('silent'),
    configuration = nconf.get('cfg');

// Define logger behaviour
logger.cli(); // activates colors

// define console logging level
logger.level = silent ? 'error' : ['info', 'debug', 'verbose', 'silly'][verbose % 4];

// Add winston file logger, which rotates daily
var fileLevel = 'silly';
logger.add(require('winston-daily-rotate-file'), {
  filename: 'log/app.log',
  json: false,
  handleExceptions: false,
  level: fileLevel,
  datePatter: '.yyyy-MM-dd_HH-mm'
});
logger.debug(`Using cfg: ${configuration}`);

// Create express instance
const app = Express();

// Create HTTP server.
const server = Server(app);

// Register socket io
const io = SocketIO(server);

// Initialize database connection
DB.connect();

// Connect models
models.registerModels();

// Bootstrap application settings
express(app);

// Bootstrap routes
routes.registerRoutes(app);

// Bootstrap addons, like default webGUI
global.AddonManager = new AddonManager(app, server, io);
global.AddonManager.RegisterAddons();

// Add final route for error
routes.registerErrorRoute(app);

function onError(error) {
  if( error.code === 'EACCES' && port < 1024 ) {
    logger.error("You haven't access to open port below 1024");
    logger.error("Please use admin rights if you wan't to use port %d!", port);
  } else {
    logger.error(error);
  }
  process.exit(-1);
}
function onListening() {
  let listenurl = `${(https?'https':'http:')}://${listen}:${port}`;
  logger.info(`OpenTMI started on ${listenurl} in ${configuration} mode`);
  eventBus.emit('start_listening', {url: listenurl});
}

server.listen(port, listen);
server.on('error', onError);
server.on('listening', onListening);

// Close the Mongoose connection, when receiving SIGINT
process.on('SIGINT', function() {
    DB.disconnect().then( () => {
        process.exit(0);
    }).catch( (err) => {
        console.error(`Disconnection fails: ${err}`);
        process.exit(-1);
    });
});

// This would be useful for testing
module.exports = {server, eventBus};
