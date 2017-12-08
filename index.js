var crypto = require('crypto');
var querystring = require('querystring');
var mysql = require('mysql');
var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser')
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
app.use(cookieParser());
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
    [ page*10 ], (err, items) => {
      if(err) throw err;
      db.query('SELECT COUNT(*) AS totalItems FROM item', (err, [{totalItems}]) => {
        if(err) throw err;
        res.json({ items, totalItems });
      });
    }
  );
});

// Retreve Item ==============================================
app.get('/item/:id', (req, res) => {
  var { id } = req.params;
  db.query(
    'SELECT * FROM item WHERE id = ?', [ id ],
    (err, [item]) => {
      if(err) throw err;
      if(item) {
        if(item.image) {
          item.image = item.image.toString('base64');
        }
        item.tags = JSON.parse(item.tags);
        res.json(item);
      } else {
        res.status(404).end();
      }
    }
  );
});

// Update Item ==============================================
app.post('/item/:id', (req, res) => {
  var { id } = req.params;
  var { title, description, value, qty, tags } = req.body;
  var {
    image: {
      data: imageData = null
    } = {}
  } = req.files || {};
  var tagStr = JSON.stringify(tags.split(' '));
  db.query(
    'UPDATE item SET title=?, description=?, image=?, value=?, qty=?, tags=? WHERE id=?',
    [ title, description, imageData, value, qty, tagStr, id ],
    err => {
      if(err) throw err;
      // redirect back to previous page
      res.redirect(req.get('Referer'));
    }
  );
});

// Delete Item ==============================================
app.delete('/item/:id', (req, res) => {
  var { id } = req.params;
  db.query('DELETE FROM item WHERE id=?', [id], err => {
    if(err) throw err;
    res.end();
  });
});

// Redeem List =============================================
app.get('/redeem', (req, res) => {
  var { username } = req.cookies;
  db.query(`
    SELECT title, value, redeem_time
    FROM redeem LEFT JOIN item ON redeem.item_id = item.id
    WHERE username = ?
  `, [username], (err, results) => {
    if(err) throw err;
    res.json(results);
  });
});

// Redeem Item ==============================================
app.post('/redeem', (req, res) => {
  var { username } = req.cookies;
  var { item } = req.body;
  db.query(
    'SELECT redeem_item(?,?) AS balance',
    [ username, item ], (err, [{balance}]) => {
      if(err) throw err;
      if(balance < 0) {
        res.status(400).end();
      } else {
        // redirect back to previous page
        res.cookie('balance', balance);
        res.redirect(req.get('Referer'));
      }
    }
  );
});

// Export CSV
app.get('/export', (_, res) => {
  db.query(`
    SELECT item.id AS id, title, value, redeem_time, username
    FROM redeem LEFT JOIN item ON redeem.item_id = item.id
  `, (err, results) => {
    if(err) throw err;
    var rows = results.map(r => [r.id, r.title, r.value, r.redeem_time.toString(), r.username]);
    rows.unshift(['Item ID', 'Title', 'Value', 'Redeem Time', 'User']);
    csvStringify(rows, (err, csv) => {
      if(err) throw err;
      res.set('Content-Disposition', 'attachment; filename=redeem.csv;');
      res.set('Content-Type', 'text/csv');
      res.send(csv);
    });
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
  
  DROP FUNCTION IF EXISTS redeem_item;
  CREATE FUNCTION redeem_item(
    user VARCHAR(64),
    item INT
  ) RETURNS INT BEGIN
    DECLARE cost INT;
    DECLARE stock INT;
    DECLARE cur_balance INT;
    DECLARE new_balance INT;
    
    SELECT value, qty INTO cost, stock FROM item WHERE id = item;
    SELECT balance INTO cur_balance FROM user WHERE username = user;
    
    IF cur_balance < cost OR stock < 1 THEN
      RETURN -1;
    END IF;
    
    UPDATE user SET balance = balance - cost WHERE username = user;
    UPDATE item SET qty = qty - 1 WHERE id = item;
    INSERT INTO redeem (username, item_id) VALUES (user, item);
    
    SELECT balance INTO new_balance FROM user WHERE username = user;
    RETURN new_balance;
  END;
  
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
