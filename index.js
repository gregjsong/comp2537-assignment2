require("./utils.js");
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const Joi = require('joi');

const app = express();

/**
 * Constants
 */
const saltRounds = 12;

const PORT = process.env.PORT || 8000;

const expireTime = 60 * 60 * 1000;

const imgArr = ['cat', 'dog', 'bunny'];

/* env variables */
const mdb_host = process.env.MONGODB_HOST;
const mdb_user = process.env.MONGODB_USER;
const mdb_password = process.env.MONGODB_PASSWORD;
const mdb_database = process.env.MONGODB_DATABASE;
const mdb_session_secret = process.env.MONGODB_SESSION_SECRET;

const node_session_secret = process.env.NODE_SESSION_SECRET;

/* database variables */
var {database} = include('databaseConnection');

const userCollection = database.db(mdb_database).collection('users');

app.set('view engine', 'ejs');

app.use(express.urlencoded({extended: false}));

var mongoStore = MongoStore.create({
  mongoUrl: `mongodb+srv://${mdb_user}:${mdb_password}@${mdb_host}/sessions`,
	crypto: {
		secret: mdb_session_secret
	}
});

app.use(session({ 
  secret: node_session_secret,
  store: mongoStore,
  saveUninitialized: false, 
  resave: true
}
));

app.use(express.static(__dirname + "/public"));

/**
 * Functions
 */
function isValidSession(req) {
  if (req.session.authenticated) {
      return true;
  }
  return false;
}

function sessionValidation(req,res,next) {
  if (isValidSession(req)) {
      next();
  }
  else {
      res.redirect('/login');
  }
}

function isAdmin(req) {
  if (req.session.user_type == 'admin') {
      return true;
  }
  return false;
}

function adminAuthorization(req, res, next) {
  if (!isAdmin(req)) {
      res.status(403);
      res.render("errorMessage", {error: "Not Authorized"});
      return;
  }
  else {
      next();
  }
}

/**
 * Routes
 */

/* Main page */
app.get('/', (req, res) => {
  if (!req.session.authenticated) {
    res.render("mainPage");
  } else {
    res.render("loggedInHomePage", {name: req.session.name});
  }
});

/* Signup page */
app.get('/signup', (req, res) => {
  res.render("signUpPage");
});

/* Log in page */
app.get('/login', (req, res)=> {
  res.render("logInPage");
});

/* handle Submit create user */
app.post('/submitUser', async (req, res) => {
  var name = req.body.name;
  var password = req.body.password;
  var email = req.body.email;

  const schema = Joi.object({
    name: Joi.string().max(20).required(),
    password: Joi.string().max(20).required(),
    email: Joi.string().email().required()
  });

  const validationResult = schema.validate({name, password, email});

  if (validationResult.error != null) {
    res.render("signUpSubmitError", {errorMessage: validationResult.error.details[0].message});
  }

  var hashedPassword = await bcrypt.hash(password, saltRounds);

  await userCollection.insertOne({
    name: name,
    password: hashedPassword,
    email: email,
    user_type: "user"
  });

  // start session
  req.session.authenticated = true;
  req.session.cookie.maxAge = expireTime;
  req.session.name = req.body.name;
  req.session.user_type = "user";
  
  req.session.save();

  res.redirect('/members');
  
});

/* Handle log in */
app.post('/loggingin', async (req, res) => {
  var email = req.body.email;
  var password = req.body.password;

  // validate email
  const schema = Joi.string().email().required();
  const validationResult = schema.validate(email);

  if (validationResult.error != null) {
    res.render("logInSubmitError", {errorType: 'Email not found'});
  }

  // find email
  const result = await userCollection.find({email: email}).project({email: 1, password: 1, name: 1, user_type: 1}).toArray();

  if (result.length != 1) {
    res.render("logInSubmitError", {errorType: 'Email not found'});
  }
  
  //validate password
  if (await bcrypt.compare(password, result[0].password)) {
    req.session.authenticated = true;
    req.session.cookie.maxAge = expireTime;
    req.session.name = result[0].name;
    req.session.user_type = result[0].user_type;
    req.session.save();

    res.redirect('/members');
    return;
  } else {
    res.render("logInSubmitError", {errorType: 'Invalid email and password combination.'});
  }
});

/* members page */
app.get('/members', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    var randomImg = imgArr[Math.floor(Math.random() * 3)];
    var filePath = randomImg + ".jpeg";

    res.render("membersPage", {name: req.session.name, filePath: filePath});
  }
});

/* log out */
app.get('/logout', (req,res) => {
  console.log("logging out");
  req.session.destroy();
  res.redirect('/');
})

/* Admin */
app.get('/admin', sessionValidation, adminAuthorization, async (req,res)=> {
  renderAdminPage(res);
});

/* Handle Admin buttons */
app.post('/handleAdminClick', express.json(), express.urlencoded({extended: true}), async (req,res)=> {
  console.log(req.body);
  const name = req.body.name;
  const action = req.body.action;

  //validate
  const schema = Joi.object({
    name: Joi.string().alphanum().max(20).required(),
    action: Joi.string().valid('promote', 'demote').required()
  });
  const validationResult = schema.validate({name, action});

  if(validationResult.error != null) {
    res.redirect("admin");
  }

  var userType = (action == 'promote') ? 'admin' : 'user';
  await userCollection.updateOne({name: name}, {
    $set: {
      user_type: userType
    }
  });

  renderAdminPage(res);
});

/* Handles 404 pages */
app.get("*", (req, res) => {
  res.status(404);
  res.render("errorMessage", {error: "Page cannot be found - 404"});
});

/* Start server */
app.listen(PORT, () => {
  console.log("Listening on port: " + PORT);
})

/**
 * Helpers
 */
async function renderAdminPage(res) {
  const result = await userCollection.find().project({name: 1, user_type: 1}).toArray();
  console.log(result);
  res.render("admin", {users: result});
}
/**
 * HTML
 */
// const mainPage = `
// <button id='signUpButton'>Sign up</button>
// <button id='logInButton'>Log in</button>
// <script>
//   document.getElementById('signUpButton').addEventListener('click', () => {
//     window.location.href = '/signup';
//   });
//   document.getElementById('logInButton').addEventListener('click', () => {
//     window.location.href = '/login'
//   });
// </script>`;

// const signUpPage = `
// <h2>Create New User</h2>
// <form action='/submitUser' method='post'>
//   <input type='text' id='name' name='name' placeholder='name'/>
//   <input type='email' id='email' name='email' placeholder='email'>
//   <input type='password' id='password' name='password' placeholder='password'/>
//   <input type='submit' name='submit'/>
// </form>`;

// const logInPage = `
// <h2>Log In</h2>
// <form id='logInForm' action='/loggingin' method='post'>
//   <input name='email' type='email' placeholder='email'>
//   <input name='password' type='password' placeholder='password'>
//   <button id='submitLogIn' type='submit' form='logInForm'
//   value='Submit'>Submit</button>
// </form>
// `;

// const loggedInHomePage = (user) => {
//   return `
//   <h2>Hello, ${user}!</h2>
//   <button id='goToMembersButton'>Go to Members Area</button>
//   <button id='logOutButton'>Logout</button>
//   <script>
//     document.getElementById('goToMembersButton').addEventListener('click', () => {
//       window.location.href = '/members';
//     });
//     document.getElementById('logOutButton').addEventListener('click', () => {
//       window.location.href = '/logout';
//     })
//   </script>
//   `;
// }

// const signUpSubmitError = (errorMessage) => {
//   return `
//   <p id='signUpSubmitMessage'>${errorMessage}</p>
//   <a href='/signup'>Try Again</a>
//   `;
// }

// const logInSubmitError = (errorType) => {
//   return `
//   <p id='signUpSubmitMessage'>${errorType}.</p>
//   <a href='/login'>Try Again</a>
//   `;
// }

// const membersPage = (name) => {
//     var randomImg = imgArr[Math.floor(Math.random() * 3)];
//     var filePath = randomImg + ".jpeg";
//     return `
//     <h2>Hello, ${name}.</h2>
//     <img src='${filePath}' width="500"/>
//     <br>
//     <button id='signOutButton'>Sign out</button>
//     <script>
//       document.getElementById('signOutButton').addEventListener('click', () => {
//         window.location.href = '/logout';
//       });
//     </script>
//     `;
// }