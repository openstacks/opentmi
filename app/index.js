const cluster = require('cluster');

// 3rd party modules
const Express = require('express');
const SocketIO = require('socket.io');
const Promise = require('bluebird');
const mongoAdapter = require('socket.io-adapter-mongo');

// application modules
const express = require('./express');
const Server = require('./server');
const nconf = require('../config');
const eventBus = require('./tools/eventBus');
const models = require('./models');
const routes = require('./routes');
const AddonManager = require('./addons');
const DB = require('./db');
const logger = require('./tools/logger');

if (nconf.get('help') || nconf.get('h')) {
  nconf.stores.argv.showHelp();
  process.exit(0);
}

// Defines
const https = nconf.get('https');
const listen = cluster.isMaster ? nconf.get('listen') : 'localhost';
const port = cluster.isMaster ? nconf.get('port') : 0;
const environment = nconf.get('env');
const dbUrl = nconf.get('db');


// Create express instance
const app = Express();

// Create HTTP server.
const server = Server(app);

// Register socket io
const io = SocketIO(server);

// Register mongo adapter for socket.io
const ioAdapter = mongoAdapter(dbUrl);
io.adapter(ioAdapter);

// Initialize database connection
DB.connect().catch((error) => {
  logger.error('mongoDB connection failed: ', error.stack);
  process.exit(-1);
}).then(() => models.registerModels())
  .then(() => express(app))
  .then(() => routes.registerRoutes(app, io))
  .then(() => AddonManager.init(app, server, io))
  .then(() => AddonManager.loadAddons())
  .then(() => AddonManager.registerAddons())
  // Error route should be initialized after addonmanager has served all static routes
  .then(() => routes.registerErrorRoute(app))
  .then(() => {
    function onError(error) {
      if (error.code === 'EACCES' && port < 1024) {
        logger.error("You haven't access to open port below 1024");
        logger.error("Please use admin rights if you wan't to use port %d!", port);
      } else {
        logger.error(error);
      }
      process.exit(-1);
    }

    function onListening() {
      const listenurl = `${(https ? 'https' : 'http:')}://${listen}:${port}`;
      logger.info(`OpenTMI started on ${listenurl} in ${environment} mode`);
      eventBus.emit('start_listening', {url: listenurl});
    }
    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(port, listen);

    // Close the Mongoose connection, when receiving SIGINT
    process.on('SIGINT', () => {
      // server.close stops worker from accepting new requests and finishes currently processed requests
      // @todo test that requests actually get processed
      logger.warn('SIGTERM received, attempt to exit OpenTMI');
      logger.debug('Closing socketIO server..');
      const ioClose = Promise.promisify(io.close, {context: io});
      const restClose = () => new Promise(resolve => server.close(resolve));
      io.emit('exit');
      ioClose().timeout(1000).catch(() => { logger.warn('there is still io connections..'); })
        .then(() => logger.debug('Closing express server'))
        .then(() => restClose()
          .timeout(1000)
          .catch(() => { logger.warn('there is still rest connections..'); }))
        .then(() => logger.debug('Closing DB connection'))
        .then(DB.disconnect.bind(DB))
        .catch((err) => {
          logger.error(`Error: ${err}`);
        })
        .finally(() => {
          logger.info('Exit OpenTMI');
          process.exit(0);
        });
    });
  });

// This would be useful for testing
module.exports = {server, eventBus};
