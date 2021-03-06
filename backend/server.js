process.env.TZ = 'Europe/Paris'

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const SerialPort = require("serialport");
const Readline = require('@serialport/parser-readline');
const fs = require('fs');
const path = require("path")
const exec = require('child_process').exec;
const archiver = require('archiver');

const configPath = './config/config.json';
const doctorsPath = './config/doctors.json';
const patientsPath = './config/patients.json';
const dataPath = './data';

const port = process.env.PORT || 4001;
const index = require("./routes/index");
const router = express.Router()

const app = express();
// Add headers
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Pass to next layer of middleware
    next();
});

app.use(index);

const server = http.createServer(app);
const io = socketIo(server); // < Interesting!

function copyFileSync( source, target ) {

    var targetFile = target;

    // If target is a directory, a new file with the same name will be created
    if ( fs.existsSync( target ) ) {
        if ( fs.lstatSync( target ).isDirectory() ) {
            targetFile = path.join( target, path.basename( source ) );
        }
    }

    fs.writeFileSync(targetFile, fs.readFileSync(source));
}

function copyFolderRecursiveSync( source, target ) {
    var files = [];

    // Check if folder needs to be created or integrated
    var targetFolder = path.join( target, path.basename( source ) );
    if ( !fs.existsSync( targetFolder ) ) {
        fs.mkdirSync( targetFolder );
    }

    // Copy
    if ( fs.lstatSync( source ).isDirectory() ) {
        files = fs.readdirSync( source );
        files.forEach( function ( file ) {
            var curSource = path.join( source, file );
            if ( fs.lstatSync( curSource ).isDirectory() ) {
                copyFolderRecursiveSync( curSource, targetFolder );
            } else {
                copyFileSync( curSource, targetFolder );
            }
        } );
    }
}

let interval;
let status = {
    app: 0,
    dashboard: 0,
    bpmSensor: 0,
    breathSensor: 0
}
let simulationStart = 0;
let simulationDiving = 0;
let dirPath;
let config;

let usersChanged = false;
let users = {
    doctor: {
        id: 0,
        firstName: "",
        lastName: ""
    },
    patient: {
        id: 0,
        firstName: "",
        lastName: "",
        birthDay: "",
        sex: "",
        weight: 0,
        height: 0
    }
};

const lengthData = 50;
let counterBpm = 0
let counterBreath = 0
let lastBpmData = []
let lastBreathData = []

let events = [] // event = JSON w/ type and time

fs.readFile(configPath, 'utf8', (err, data) => {
    config = JSON.parse(data)
})

let clients = {
    app: 1,
    dashboard: 0
};

let fillTemplateEnded = false

function fillTemplate(pathData, newPathData) {
    console.log("Filling template")

    const finalPath = dataPath + "/" + pathData
    let template = fs.readFileSync(finalPath + "/index.html", 'utf8')

    template = template.split("{{name}}").join(newPathData)

    let times = 0
    try {
        times = fs.readFileSync(finalPath + "/times.json", 'utf8')
    } catch (err) {
        console.log("No Times found.")
    }
    template = template.replace("{{times}}", times ? times : "{}")

    let bpmData = 0
    try {
        bpmData = fs.readFileSync(finalPath + "/bpm.json", 'utf8')
    } catch(err) {
        console.log("No BPM Data found.")
    } 
    template = template.replace("{{bpmData}}", bpmData ? bpmData : "[]")

    let breathData = 0
    try {
        breathData = fs.readFileSync(finalPath + "/breath.json", 'utf8')
    } catch(err) {
        console.log("No Breath Data found.")
    } 
    template = template.replace("{{breathData}}", breathData ? breathData : "[]")

    template = template.replace("{{srcVideo}}", "video-0.mp4") // TODO: if multiple videos ?

    fs.writeFileSync(finalPath + "/index.html", template, 'utf8', err => {
        if (err) throw err;
        console.log('Template has been completed!');
    });

    fillTemplateEnded = true
}

io.on("connection", (socket) => {
    console.log("CONNECTION : Someone connected, waiting for identification")
    socket.on("who", (data) => {
        switch(data) {
            case "dashboard":
                console.log("Dashboard connected!")
                clients.dashboard = socket
                status.dashboard = 2

                // Server Clock
                if (interval) {
                    clearInterval(interval);
                }

                interval = setInterval(() => getApiAndEmit(socket), 1000);
                break
            case "app":
                console.log("App connected!")
                clients.app = socket
                status.app = 2
                break
            default:
                console.log("Can't verify identity")
                break
        }
                
        if(status.app !== 0 && status.dashboard !== 0) {
            console.log("Sync done! Start Simulation.")
            if(simulationStart === 0) {
                simulationStart = new Date()
            
                const month = simulationStart.getUTCMonth() + 1
                dirPath = "./data/" + config.currentIdData + "_" + simulationStart.getFullYear() + "-" + month + "-" + simulationStart.getUTCDate() + "_" + users.doctor.id + "-" + users.patient.id
                config.currentIdData += 1
                fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8', err => {
                    if (err) throw err;
                    console.log('File has been saved!');
                });
                fs.mkdirSync(dirPath, { recursive: true })
                console.log(dirPath)
            }
            io.emit("sync", simulationStart)
            
            
        }
    })

    socket.on("app-play", () => {
        console.log("Dashboard > App : Play")
        events.push({
            type: "play",
            date: new Date()
        })
        io.emit("app-play")
    })

    socket.on("app-pause", () => {
        console.log("Dashboard > App : Pause")
        events.push({
            type: "pause",
            date: new Date()
        })
        io.emit("app-pause")
    })

    socket.on("app-stop", () => {
        console.log("Dashboard > App : Stop")
        events.push({
            type: "stop",
            date: new Date()
        })
        io.emit("app-stop")
        if(simulationStart !== 0) {
            console.log("EXPORT : App Stopped. Start Export Procedure.")
            // Export
            times = {
                "immersion": simulationStart,
                "diving": simulationDiving, // to be changed
                "end": new Date(),
                "events": events
            }

            fs.writeFile(dirPath + "/times.json", JSON.stringify(times, null, 2), 'utf8', err => {
                if (err) throw err;
                console.log('File has been saved!');
            });

            let isCaptureDone = false;
            while (!isCaptureDone) {
                isCaptureDone = !!+fs.readdirSync("./captures").length
            }
            
            fs.readdir("./captures", (err, files) => {
                let i = 0;
                files.forEach(file => {
                        fs.rename("./captures/" + file, dirPath + "/video-" + i + ".mp4", err => {
                            if (err) throw err;
                            console.log('Moving ' + file);  
                        });
                        i++
                   }
                )
            })
        }
    })

    socket.on("app-bpm", (mode) => {
        console.log("EVENT : Dashboard > App : BPM Mode " + mode)
        io.emit("app-bpm", mode)
    })

    socket.on("app-event", (id) => {
        console.log("EVENT : Dashboard > App : Event ID " + id)
        io.emit("app-event", id)
    })

    socket.on("app-diving", () => {
        simulationDiving = new Date()
        console.log("EVENT : Dashboard > App : Diving")
        // io.emit("app-diving")
    })

    socket.on("dashboard-new-doctor", (data) => {
        console.log("USERS : Dashboard : New Doctor")
        fs.readFile(doctorsPath, 'utf8', function readFileCallback(err, doctors) {
            if (err) {
                console.log(err);
            } else {
                doctors = JSON.parse(doctors)
                data.id = doctors[doctors.length - 1].id + 1
                doctors.push(data)
                fs.writeFile(doctorsPath, JSON.stringify(doctors, null, 2), 'utf8', err => {
                    if (err) throw err;
                    console.log('File has been saved!');
                });
            }
        });

        
    })
    socket.on("dashboard-new-patient", (data) => {
        console.log("USERS : Dashboard : New Patient")
        fs.readFile(patientsPath, 'utf8', function readFileCallback(err, patients) {
            if (err) {
                console.log(err);
            } else {
                patients = JSON.parse(patients)
                data.id = patients[patients.length - 1].id + 1
                patients.push(data)
                fs.writeFile(patientsPath, JSON.stringify(patients, null, 2), 'utf8', err => {
                    if (err) throw err;
                    console.log('File has been saved!');
                });
            }
        });
    })

    socket.on("dashboard-update-users", (data) => {
        console.log("USERS : Dashboard : Update Current Users")
        usersChanged = true
        users = data
    })

    socket.on("dashboard-medical-report", data => {
        console.log("EXPORT : Dashboard : Medical Report")
        
        fs.writeFile(dirPath + "/medical-report.json", JSON.stringify(data, null, 2), 'utf8', err => {
            if (err) throw err;
            console.log('File has been saved!');
        });
    })

    socket.on("dashboard-export", (dataId) => {
        // data : study id
        // Look for the correct folder
        let pathData;
        let newPathData;
        dataId = parseInt(dataId)

        fs.readdirSync(dataPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => {
            dat = dirent.name
            content = dat.split("_") // ID - Date - Users (docteur + patient)
            id = parseInt(content[0])

            if(dataId === id) {
                pathData = dat
                newPathData = id + "_" + content[1]
            }
        })

        const finalPath = dataPath + "/" + pathData

        try {
            fs.readFileSync(finalPath + "/" + newPathData + ".zip", 'utf8')
        } catch (err) {
            // Put export-template in data folder
            copyFolderRecursiveSync("./export-template/static", finalPath)
            copyFileSync("./export-template/index.html", finalPath)

            // Replace variables in template
            fillTemplate(pathData, newPathData)

            while(!fillTemplateEnded) {}

            let output = fs.createWriteStream(finalPath + "/" + newPathData + ".zip");
            let archive = archiver('zip');

            output.on('close', function () {
                console.log(archive.pointer() + ' total bytes');
                console.log('archiver has been finalized and the output file descriptor has closed.');
            });

            archive.on('error', function(err){
                throw err;
            });

            archive.pipe(output);

            // append files from a sub-directory, putting its contents at the root of archive
            archive.directory(finalPath, false); // false => newPathData to rename ?

            archive.finalize();
        }

        app.get("/data/" + dataId, (req, res) => {
            res.download(finalPath + "/" + newPathData + ".zip")
        })
    })

    socket.on("disconnect", () => {

        console.log("DISCONNECTION : Someone disconnected");

        if (socket === clients.app) {

            clients.app = 0
            status.app = 1
            /* io.emit("app-sync") */
            console.log("App desync. It may be normal : please wait for reconnexion (3 seconds)")

            setTimeout(() => {
                if(clients.app === 0) {
                    /* io.emit("app-disconnected") */
                    console.log("App disconnected. Please restart the app.")
                }
            }, 3000)

        } else if(socket === clients.dashboard)  {

            clients.dashboard = 0
            status.dashboard = 1
            /* io.emit("dashboard-sync") */
            console.log("Dashboard desync. It may be normal : please wait for reconnexion (3 seconds)")

            setTimeout(() => {
                if(clients.dashboard === 0) {
                    /* io.emit("dashboard-disconnected") */
                    console.log("Dashboard disconnected. Please restart the dashboard.")
                }
            }, 3000)

        } else {

            console.log("Unknown disconnection. Clients socket info : " + clients)

        }

    });
});

const getApiAndEmit = socket => {
    const data = {
        deltaTime: 0,
        status: status,
        usersChanged: usersChanged,
        doctor: users.doctor,
        patient: users.patient,
        data: {
            bpm: lastBpmData,
            breath: lastBreathData 
        }
    }

    if(simulationStart !== 0) {
        data.deltaTime = ((new Date()) - simulationStart)
    }

    socket.emit("ping", data)
};

// BPM Sensor
let spBpm = new SerialPort("COM4", {
    baudRate: 9600
});
const parserBpm = spBpm.pipe(new Readline({ delimiter: '\r\n' }));

spBpm.on("open", function() {
    console.log('COM4 opened (first USB port on the front of the computer)');
    status.bpmSensor = 1;
    parserBpm.on('data', function(data) {
        // console.log('Data received from COM4: ' + data);
        if(simulationStart !== 0) {
            const serverClock = (new Date()) - simulationStart;
            counterBpm += 1
            if(lastBpmData.length >= lengthData) {
                lastBpmData.shift();
            }
            lastBpmData.push({
                x: serverClock,
                y: parseInt(data, 10)
            });
            if(counterBpm >= 50) {
                counterBpm = 0
                fs.readFile(dirPath + "/bpm.json", 'utf8', function readFileCallback(err, bpmJson) {
                    if (err) {
                        bpmJson = lastBpmData
                    } else {
                        bpmJson = JSON.parse(bpmJson)
                        bpmJson.push(...lastBpmData)
                    }

                    fs.writeFile(dirPath + "/bpm.json", JSON.stringify(bpmJson, null, 2), 'utf8', err => {
                        if (err) throw err;
                        console.log('File has been saved!');
                    });
                });
            }
        }
    });
});

// Breath Sensor
let spBreath = new SerialPort("COM5", {
    baudRate: 9600
});
const parserBreath = spBreath.pipe(new Readline({ delimiter: '\r\n' }));

spBreath.on("open", function() {
    console.log('COM5 opened (first USB port on the front of the computer)');
    status.breathSensor = 1;

    parserBreath.on('data', function(data) {
        // console.log('Data received from COM5: ' + data);
        if(simulationStart !== 0) {
            const serverClock = (new Date()) - simulationStart;
            counterBreath += 1
            if(lastBreathData.length >= lengthData) {
                lastBreathData.shift();
            }
            lastBreathData.push({
                x: serverClock,
                y: parseInt(data, 10)
            });
            if(counterBreath >= 50) {
                counterBreath = 0
                fs.readFile(dirPath + "/breath.json", 'utf8', function readFileCallback(err, breathJson) {
                    if (err) {
                        breathJson = lastBreathData
                    } else {
                        breathJson = JSON.parse(breathJson)
                        breathJson.push(...lastBreathData)
                    }

                    fs.writeFile(dirPath + "/breath.json", JSON.stringify(breathJson, null, 2), 'utf8', err => {
                        if (err) throw err;
                        console.log('File has been saved!');
                    });
                });
            }
        }
    });
}); 


server.listen(port, () => console.log(`Listening on port ${port}`));