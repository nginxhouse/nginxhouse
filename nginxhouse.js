const fs = require('fs');
const url = require('url');
const http = require('http');
const dgram = require('dgram');
const cluster = require('cluster');
const os = require('os');
const child_process = require('child_process');

const server = dgram.createSocket('udp4');

const config = JSON.parse(fs.readFileSync('config.json'));
const clickhouseOptions = url.parse(config.clickhouse.url);
clickhouseOptions.path += `&query=INSERT+INTO+${config.clickhouse.table}+FORMAT+JSONEachRow`;
clickhouseOptions.method = 'POST';
clickhouseOptions.headers = {'Content-Type': 'text/plain'};
clickhouseOptions.timeout = config.clickhouse.timeout * 1000;

function errorLog(error) {
    console.log(error);
    fs.appendFile(config.errorLog, `${new Date().toISOString()}: ${error}\n`, () => {});
}

function saveUnsentRows(rows) {
    //console.log(rows);
    if (!rows || !config.unsentRowsDir) return;

    fs.appendFile(`${config.unsentRowsDir}/${new Date().toISOString()}.log`, rows, (error) => {if (error) {errorLog(error);}});
}

function saveUnsentRowsSync(rows) {
    //console.log(rows);
    if (!rows || !config.unsentRowsDir) return;

    fs.appendFileSync(`${config.unsentRowsDir}/${new Date().toISOString()}.log`, rows);
}

let lockForSending = false;

function sendRows(rows) {
    clickhouseOptions.headers['Content-Length'] = Buffer.byteLength(rows);
    const request = http.request(clickhouseOptions);

    //request.setNoDelay(true);

    request.on('response', (response) => {
        let data = '';
        response.on('data', function (chunk) {
            data += chunk;
        });
        response.on('end', (response) => {
            if (data !== '') {
                //console.log(data);
            }
            lockForSending = false;
        });
    });

    request.on('error', (error) => {
        errorLog(error);
        saveUnsentRows(rows);
        lockForSending = false;
    });

    request.on('timeout', () => {
        request.abort();
    });

    request.write(rows);
    request.end();
}

if (cluster.isMaster) {
    if (!config.forks) {
        config.forks = os.cpus().length;
    }

    // Fork workers.
    for (let i = 0; i < config.forks; i++) {
        cluster.fork();
    }

    //send unsent rows automatically

    setInterval(() => {
        if (!config.unsentRowsDir || lockForSending) return;
        lockForSending = true;

        //fs.readdir(config.unsentRowsDir, (error, files) => {
            //console.log(files);
            child_process.exec(`find unsent_rows -type f -mmin +${1+config.timer/60} | while read i; do cat "$i" | curl '${config.clickhouse.url}&query=INSERT+INTO+${config.clickhouse.table}+FORMAT+JSONEachRow' --data-binary @- && rm -f "$i"; done`, (error) => {
                //console.log(result);
                if (error) {errorLog(error);}
                lockForSending = false;
            });
        //});
    }, config.resendTimer * 1000);
} else {
    server.on('error', (err) => {
        errorLog(`server error:\n${err.stack}`);
        server.close();
    });

    let rows = '';

    server.on('message', (message, rinfo) => {
        rows += message.toString()
            .replace(/^[^{]+({.*})$/gim, '$1') //find json
            .replace(/"\s*:\s*,/, '": 0,') //fix wrong nginx json format
            .replace(/("timestamp":\s*"[^+]+)\+[^"]+"/, '$1"') + "\n"; //fix incompatible nginx time format
    });

    server.on('listening', () => {
        //const address = server.address();
        //console.log(`server listening ${address.address}:${address.port}`);
    });

    setInterval(function () {
        if (rows && !lockForSending) {
            lockForSending = true;

            sendRows(rows);
            rows = '';
            //console.log(rows);
        }
    }, config.timer * 1000);

    process.on('SIGTERM', () => { //service nginxhouse stop
        saveUnsentRowsSync(rows);
        rows = '';
        process.exit(0);
    });

    process.on('SIGINT', () => { // ctrl + C
        saveUnsentRowsSync(rows);
        rows = '';
        process.exit(0);
    });

    server.bind(config.port, config.host);
}