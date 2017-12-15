var crypto = require('crypto');
var querystring = require('querystring');
var mysql = require('mysql');
var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser')
var fileUpload = require('express-fileupload');
var csvStringify = require('csv-stringify');
var session = require('express-session')

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

//function used to constraint html elements input =========
function strip_tags(input, allowed) {
  allowed = (((allowed || '') + '')
  .toLowerCase()
  .match(/<[a-z][a-z0-9]*>/g) || [])
  .join('');
  var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
  commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;
  return input.replace(commentsAndPhpTags, '')
  .replace(tags, function($0, $1) {
    return allowed.indexOf('<' + $1.toLowerCase() + '>') > -1 ? $0 : '';
  });
}

// Session ================================================
app.use( session({
    secret: 'mysecretkey',
    cookie:{maxAge:null},
    resave: false,
    saveUninitialized: false})
);

function checkAuth(req,res,next){
  if (!req.session.username){
    console.log(req.session.username)
    console.log('no login');
    res.status(403).send("please login first");
  }else{
    next();
  }
}

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
          req.session.regenerate(()=>{
            req.session.username = username;
            res.redirect('/admin.html');
          });
          //res.redirect('/admin.html');
        } else {
          // login as normal user
          req.session.regenerate(()=>{
            req.session.username = username;
            res.cookie('username', username);
            res.cookie('balance', results[0].balance);
            res.redirect('/user.html');
          });
          //res.cookie('username', username);
          //res.cookie('balance', results[0].balance);
          //res.redirect('/user.html');
        
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

// Logout =========================================
app.get('/logout',(req,res)=>{
  req.session.destroy(()=>{
    res.clearCookie("username");
    res.clearCookie("balance");
    res.redirect('/');
  });
})

// Create Item ==============================================
app.post('/item',checkAuth, (req, res) => {
  var { title, description, value, qty, tags } = req.body;
  var {
    image: {
      data: imageData = null
    } = {}
  } = req.files || {};
  var tagStr = JSON.stringify(tags.split(' '));
  var striped_description = strip_tags(description,"<b><i><u><pre><p><br>");
  db.query(
    `INSERT INTO item (title, description, image, value, qty, tags) VALUES (?,?,?,?,?,?)`,
    [ title, striped_description, imageData, value, qty, tagStr ],
    err => {
      if(err) throw err;
      // redirect back to previous page
      res.redirect(req.get('Referer'));
    }
  );
});

// Retreve Item List ==============================================
app.get('/item',checkAuth, (req, res) => {
  var { sortDesc, sortValue, page = 0, all = false} = req.query;
  var sortField = sortValue ? 'value' : 'create_time';
  var sortOrder = sortDesc ? 'DESC' : 'ASC';
  console.log("Item list session : " + req.session.username);
  if (all){
    db.query(
    `SELECT id, title, value, qty, create_time FROM item ORDER BY ${sortField} ${sortOrder} `, 
    (err, items) => {
      if(err) throw err;
      db.query('SELECT COUNT(*) AS totalItems FROM item', (err, [{totalItems}]) => {
        if(err) throw err;
        res.json({ items, totalItems });
      });
    }
  );
  }
  else{
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
  }
});

// Retreve Item ==============================================
app.get('/item/:id',checkAuth, (req, res) => {
  var { id } = req.params;
  console.log("Item view session : " + req.session.username);
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
app.post('/item/:id',checkAuth, (req, res) => {
  var { id } = req.params;
  var { title, description, value, qty, tags } = req.body;
  var {
    image: {
      data: imageData = null
    } = {}
  } = req.files || {};
  var tagStr = JSON.stringify(tags.split(' '));
  var striped_description = strip_tags(description,"<b><i><u><pre><p><br>");
  db.query(
    'UPDATE item SET title=?, description=?, image=?, value=?, qty=?, tags=? WHERE id=?',
    [ title, striped_description, imageData, value, qty, tagStr, id ],
    err => {
      if(err) throw err;
      // redirect back to previous page
      res.redirect(req.get('Referer'));
    }
  );
});

// Delete Item ==============================================
app.delete('/item/:id',checkAuth, (req, res) => {
  var { id } = req.params;
  db.query('DELETE FROM item WHERE id=?', [id], err => {
    if(err) throw err;
    res.end();
  });
});

// Redeem List =============================================
app.get('/redeem',checkAuth, (req, res) => {
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
app.post('/redeem',checkAuth, (req, res) => {
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
app.get('/export',checkAuth, (_, res) => {
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
  
  DROP TRIGGER IF EXISTS delete_item_redeem;
  CREATE TRIGGER delete_item_redeem
  BEFORE DELETE ON item FOR EACH ROW BEGIN
    DELETE FROM redeem WHERE item_id = OLD.id;
  END;
  
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
