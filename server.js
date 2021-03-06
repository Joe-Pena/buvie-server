'use strict';
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const passport = require('passport');
const socket = require('socket.io');

// Here we use destructuring assignment with renaming so the two variables
// called router (from ./users and ./auth) have different names
// For example:
// const actorSurnames = { james: "Stewart", robert: "De Niro" };
// const { james: jimmy, robert: bobby } = actorSurnames;
// console.log(jimmy); // Stewart - the variable name is jimmy, not james
// console.log(bobby); // De Niro - the variable name is bobby, not robert
const { router: usersRouter } = require('./users');
const { router: authRouter, localStrategy, jwtStrategy, googleStrategy } = require('./auth');
const { router: moviesRouter } = require('./movies');
const { router: genresRouter } = require('./main/genres');
const {router: messagesRouter} = require('./conversation/router');

mongoose.Promise = global.Promise;
const { PORT, DATABASE_URL } = require('./config');

const app = express();

const jwtAuth = passport.authenticate('jwt', { session: false });

// Logging
app.use(morgan('common'));

// CORS
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
  if (req.method === 'OPTIONS') {
    return res.send(204);
  }
  next();
});

app.use(passport.initialize());

passport.use(localStrategy);
passport.use(jwtStrategy);
passport.use(googleStrategy);
passport.serializeUser((user, done) => {
  done(null, user.serialize());
});
passport.deserializeUser((user, done) => {
  user.findOne({ _id: user.id })
    .then(user => done(null, user));
});


//MOUNT ROUTERS

app.use('/api/main', jwtAuth);
app.use('/api/main', genresRouter);
app.use('/api/users/', usersRouter);

app.use('/api/messages', jwtAuth);
app.use('/api/messages', messagesRouter);

app.use('/api/auth/', authRouter);
app.use('/api/movies/', jwtAuth);

app.use('/api/movies/', moviesRouter);

// A protected endpoint which needs a valid JWT to access it
app.get('/api/protected', jwtAuth, (req, res) => {
  return res.json({
    data: 'rosebud'
  });
});

app.use('*', (req, res) => {
  return res.status(404).json({ message: 'Not Found' });
});

//Custom error handler
app.use((err, req, res, next) => {
  if (err.status) {
    const errBody = Object.assign({}, err, { message: err.message });
    res.status(err.status).json(errBody);
  } else {
    console.log(err);
    res.status(500).json({ message: 'internal server error' });
  }
});

// Referenced by both runServer and closeServer. closeServer
// assumes runServer has run and set `server` to a server object
let server;

function runServer(databaseUrl, port = PORT) {
  return new Promise((resolve, reject) => {
    mongoose.connect(
      databaseUrl,
      err => {
        if (err) {
          return reject(err);
        }
        server = app
          .listen(port, () => {
            console.log(`Your app is listening on port ${port}`);
            resolve();
          })
          .on('error', err => {
            mongoose.disconnect();
            reject(err);
          });
      }
    );
  });
}

function closeServer() {
  return mongoose.disconnect().then(() => {
    return new Promise((resolve, reject) => {
      console.log('Closing server');
      server.close(err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });
}

if (require.main === module) {
  runServer(DATABASE_URL)
    .then(() => {
      const io = socket(server);
      io.on('connection', (socket) => {
        console.log('made connection', socket.id);
        socket.on('subscribe', room => {
          console.log('joining ', room);
          socket.join(room);
        });

        socket.on('chat', data => {
          console.log(data, 'to ', data.room);
          io.sockets.in(data.room).emit('chat', data);
        });
      });
    }

    ).catch(err => console.error(err));
}

module.exports = { app, runServer, closeServer };
