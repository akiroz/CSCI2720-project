var crypto = require('crypto');
var querystring = require('querystring');
var mysql = require('mysql');
var express = require('express');
var bodyParser = require('body-parser');
var fileUpload = require('express-fileupload');
var csvStringify = require('csv-stringify');

// config database
var db = mysql.createConnection({
  host: process.env.IP,
  user: process.env.C9_USER,
  password: '',
  database: 'c9',
  multipleStatements: true
});

// config app
var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(fileUpload());

// Login ==============================================
app.post('/login', (req, res) => {
  var username = req.body.username;
  var pHash = crypto.createHash('sha256');
  pHash.update(req.body.password);

  db.query(
    'SELECT balance FROM user WHERE username = ? AND password = ?',
    [username, pHash.digest('hex')],
    (err, results) => {
      if(err) throw err;

      if(results.length) {
        if(username === 'admin') {
          // login as admin
          res.redirect('/admin.html');
        } else {
          // login as normal user
          res.cookie('username', username);
          res.cookie('balance', results[0].balance);
          res.redirect('/user.html');
        }
      } else {
        // login failed
        var qs = querystring.stringify({
          error: 'Invalid username or password'
        });
        res.redirect(`/?${qs}`);
      }

    }
  );
});

// Create Item ==============================================
app.post('/item', (req, res) => {
  var { title, description, value, qty, tags } = req.body;
  var {
    image: {
      data: imageData = null
    } = {}
  } = req.files || {};
  var tagStr = JSON.stringify(tags.split(' '));
  db.query(
    `INSERT INTO item (title, description, image, value, qty, tags) VALUES (?,?,?,?,?,?)`,
    [ title, description, imageData, value, qty, tagStr ],
    err => {
      if(err) throw err;
      // redirect back to previous page
      res.redirect(req.get('Referer'));
    }
  );
});
// Retreve Item List ==============================================
app.get('/item', (req, res) => {
  var { sortDesc, sortValue, page = 0 } = req.query;
  var sortField = sortValue ? 'value' : 'create_time';
  var sortOrder = sortDesc ? 'DESC' : 'ASC';
  db.query(
    `SELECT id, title, value, qty, create_time FROM item ORDER BY ${sortField} ${sortOrder} LIMIT 10 OFFSET ?`,
    [ page*10 ],
    (err, results) => {
      if(err) throw err;
      res.json(results);
    }
  );
});
// Retreve Item ==============================================
app.get('/item/:id', (req, res) => {
  var { id } = req.param;
  db.query(
    'SELECT * FROM item WHERE id = ?', [ id ],
    (err, [item]) => {
      if(err) throw err;
      res.json(item);
    }
  );
});
// Update Item ==============================================
app.put('/item/:id', (req, res) => {
  var { id } = req.param;
  var { title, description, image, value, qty, tags } = req.body;
  db.query(
    'UPDATE item SET title=? description=? image=? value=? qty=? tags=? WHERE id=?',
    [ title, description, image, value, qty, tags, id ],
    err => {
      if(err) throw err;
      res.end();
    }
  );
});
// Delete Item ==============================================
app.delete('/item/:id', (req, res) => {
  var { id } = req.param;
  db.query('DELETE FROM item WHERE id=?', [id], err => {
    if(err) throw err;
    res.end();
  });
});

// serve static files from public folder
app.use(express.static('public'));

var initSQL = `
  CREATE TABLE IF NOT EXISTS item (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    title       TEXT,
    description TEXT,
    image       LONGBLOB, ${/* 4GiB Max */''}
    value       INT,
    qty         INT,
    tags        TEXT, ${/* JSON array */''}
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS user (
    username  VARCHAR(64) PRIMARY KEY,
    password  TEXT,
    balance   INT
  );
  CREATE TABLE IF NOT EXISTS redeem (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    username    VARCHAR(64),
    item_id     INT,
    redeem_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES user(username),
    FOREIGN KEY (item_id) REFERENCES item(id)
  );
  INSERT INTO user VALUES (
    'admin', ${/* password: admin */''}
    '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
    0
  ) ON DUPLICATE KEY UPDATE username=username;
  INSERT INTO user VALUES (
    'bob', ${/* password: user */''}
    '04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb',
    100
  ) ON DUPLICATE KEY UPDATE username=username;
  INSERT INTO user VALUES (
    'alice', ${/* password: user */''}
    '04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb',
    200
  ) ON DUPLICATE KEY UPDATE username=username;
`;

db.query(initSQL, err => {
  if(err) throw err;
  app.listen(process.env.PORT);
});
