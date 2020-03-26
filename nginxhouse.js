const fs = require('fs');
const url = require('url');
const http = require('http');
const dgram = require('dgram');
const cluster = require('cluster');
const os = require('os');

const server = dgram.createSocket('udp4');

const config = JSON.parse(fs.readFileSync('config.json'));
const clickhouseOptions = url.parse(config.clickhouse.url);
clickhouseOptions.path += `&query=INSERT+INTO+${config.clickhouse.table}+FORMAT+JSONEachRow`;
clickhouseOptions.method = 'POST';
clickhouseOptions.headers = {'Content-Type': 'text/plain'};
clickhouseOptions.timeout = config.clickhouse.timeout * 1000;

function errorLog(error) {
    console.log(error);
    fs.appendFileSync(config.errorLog, new Date().toISOString() + ': '+ error);
}

if (cluster.isMaster) {
    if (!config.forks) {
        config.forks = os.cpus().length;
    }

    // Fork workers.
    for (let i = 0; i < config.forks; i++) {
        cluster.fork();
    }

    //todo: send unsent rows automatically
} else {
    server.on('error', (err) => {
        errorLog(`server error:\n${err.stack}`);
        server.close();
    });

    let rows = '';
    let rowsBuffer = '';

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

    let lockForSending = false;
    setInterval(function () {
        if (rows && !lockForSending) {
            lockForSending = true;

            rowsBuffer = rows;
            rows = '';
            //console.log(rows);

            clickhouseOptions.headers['Content-Length'] = Buffer.byteLength(rowsBuffer);
            var request = http.request(clickhouseOptions);

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
                    rowsBuffer = '';
                    lockForSending = false;
                });
            });

            request.on('error', (error) => {
                errorLog(error);
                fs.appendFile(config.unsentRowsLog, rowsBuffer, (error) => {
                    if (error) {
                        errorLog(error);
                    }
                    rowsBuffer = '';
                    lockForSending = false;
                });
            });

            request.on('timeout', () => {
                request.abort();
            });

            request.write(rowsBuffer);
            request.end();
        }
    }, config.timer * 1000);

    process.on('SIGTERM', () => { //service nginxhouse stop
        fs.appendFileSync(config.unsentRowsLog, rows);
        rows = '';
        process.exit(0);
    });

    process.on('SIGINT', () => { // ctrl + C
        fs.appendFileSync(config.unsentRowsLog, rows);
        rows = '';
        process.exit(0);
    });

    server.bind(config.port, config.host);
}