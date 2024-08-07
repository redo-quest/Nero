const settings = require('../../handlers/readSettings').settings();
const mailer = require("../../handlers/mailer").mailer();
const makeid = require("../../handlers/makeid");
const fetch = require("node-fetch");
const Swal = require('sweetalert2');

function sendAlert(res, message) {
  res.send(`
    <html>
    <head>
      <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    </head>
    <body>
      <script>
        Swal.fire({
          icon: 'error',
          title: 'Oops...',
          text: '${message}',
        }).then(() => {
          window.history.back();
        });
      </script>
    </body>
    </html>
  `);
}


module.exports.load = async function(app, ejs, db) {
  app.get("/auth/login", async (req, res) => {
    if (!req.query.email || !req.query.password) {
      return res.json({ error: "Missing information." });
    }
    const user = await db.get(`user-${req.query.email}`);
    if (!user) {
      return res.json({ error: "Invalid Email or Password." });
    }
    if (user.password !== req.query.password) {
      return res.json({ error: "Invalid Email or Password." });
    }

    let cacheaccount = await fetch(
      `${settings.pterodactyl.domain}/api/application/users/${await db.get(`users-${req.query.email}`)}?include=servers`,
      {
        method: "get",
        headers: { 'Content-Type': 'application/json', "Authorization": `Bearer ${settings.pterodactyl.key}` }
      }
    );
    if (await cacheaccount.statusText == "Not Found") {
      return res.json({ error: "An error has occurred while attempting to get your user information." });
    }
    cacheaccount = JSON.parse(await cacheaccount.text());

    req.session.pterodactyl = cacheaccount.attributes;
    req.session.userinfo = user;
    return res.json({ success: true });
  });

  app.get("/auth/register", async (req, res) => {
    if (!req.query.email || !req.query.username || !req.query.password) {
      return res.json({ error: "Missing information." });
    }
    if (await db.get(`user-${req.query.email}`)) {
      return res.json({ error: "Already registered." });
    }
    
    const userinfo = {
      username: req.query.username,
      id: req.query.email,
      password: req.query.password,
      discriminator: null
    };

    const accountjson = await fetch(
      `${settings.pterodactyl.domain}/api/application/users`, {
        method: "post",
        headers: {
          'Content-Type': 'application/json',
          "Authorization": `Bearer ${settings.pterodactyl.key}`
        },
        body: JSON.stringify({
          username: req.query.username,
          email: req.query.email,
          first_name: req.query.username,
          last_name: "(credentials)",
          password: req.query.password
        })
      }
    );

    if (accountjson.status == 201) {
      const accountinfo = JSON.parse(await accountjson.text());
      await db.set(`users-${req.query.email}`, accountinfo.attributes.id);
    } else {
      let accountlistjson = await fetch(
        `${settings.pterodactyl.domain}/api/application/users?include=servers&filter[email]=${encodeURIComponent(req.query.email)}`, {
          method: "get",
          headers: {
            'Content-Type': 'application/json',
            "Authorization": `Bearer ${settings.pterodactyl.key}`
          }
        }
      );
      const accountlist = await accountlistjson.json();
      const user = accountlist.data.filter(acc => acc.attributes.email == req.query.email);
      if (user.length == 1) {
        let userid = user[0].attributes.id;
        await db.set(`users-${userinfo.id}`, userid);
      } else {
        return res.json({ error: "An error has occurred when attempting to create your account." });
      }
    }

    let cacheaccount = await fetch(
      `${settings.pterodactyl.domain}/api/application/users/${await db.get(`users-${req.query.email}`)}?include=servers`,
      {
        method: "get",
        headers: { 'Content-Type': 'application/json', "Authorization": `Bearer ${settings.pterodactyl.key}` }
      }
    );
    if (await cacheaccount.statusText == "Not Found") {
      return res.json({ error: "An error has occurred while attempting to get your user information." });
    }
    
    let cacheaccountinfo = JSON.parse(await cacheaccount.text());
    await db.set(`user-${req.query.email}`, userinfo);
    await db.set(`username-${userinfo.id}`, req.query.username);

    let userdb = await db.get("userlist");
    userdb = userdb ? userdb : [];
    if (!userdb.includes(`${userinfo.id}`)) {
      userdb.push(`${userinfo.id}`);
      await db.set("userlist", userdb);
    }
    if (settings.smtp.enabled == true) {
      mailer.sendMail({
        from: settings.smtp.mailfrom,
        to: userinfo.id,
        subject: `Signup`,
        html: `Here are your login details for ${settings.name} Panel:\n Username: ${req.query.username}\n Email: ${userinfo.id}\n Password: ${userinfo.password}`
      });
    }
    req.session.pterodactyl = cacheaccountinfo.attributes;
    req.session.userinfo = userinfo;
    return res.redirect("/dashboard");
  });
}
