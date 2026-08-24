const db = require('./db');

db.serialize(() => {
  db.get('SELECT COUNT(*) AS c FROM expenses', (err, row) => {
    if (err) return console.error('COUNT error:', err.message);
    console.log('Before:', row.c);
    db.run('DELETE FROM expenses', function(err) {
      if (err) return console.error('DELETE error:', err.message);
      db.get('SELECT COUNT(*) AS c FROM expenses', (err2, row2) => {
        if (err2) return console.error('COUNT2 error:', err2.message);
        console.log('After:', row2.c);
        process.exit(0);
      });
    });
  });
});
