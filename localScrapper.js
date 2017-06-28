const fs = require('fs')
const async = require('async')
const { chain, kebabCase, last, omit } = require('lodash')
const argv = require('minimist')(process.argv.slice(2))

if (argv.h || argv.help) {
  console.log('usage: node localScrapper.js [options]\n')
  console.log('  --directory      Base directory to scrap (default : ./karaoke)')
  console.log('  --useSubDirs     Use sub directories instead of grouping by topmost directories')
  process.exit(1)
}

const karaokeDirectory = argv.directory || 'karaoke'
const groupBySubdirectories = !!argv.useSubDirs

const REGEX_WITH_LANGUAGE = /^(.+) - ([A-Z0-9 ]+) - (.+) ? (\(.{3}\))\.(.{2,4})$/
const REGEX_WITHOUT_LANGUAGE = /^(.+) - ([A-Z0-9 ]+) - (.+)\.(.{2,4})$/

const isVideoExtension = extension => [
  '3gp', 'mp4', 'flv', 'avi', 'webm', 'mkv', 'wmv', 'mpg',
].includes(extension.toLowerCase())
const isSubtitlesExtension = extension => ['ass', 'ssa'].includes(extension.toLowerCase())

function getFileInfos(fileName, dirPath, stat) {
  let group
  let type
  let songName
  let languageString
  let extension

  const directories = dirPath.split('/')
  // Group by subdirectories : Take the name of the last directory (/karaoke/TEMP/Anime >> Anime)
  // Group by top directory : Take the name of the topmost directory, excluding the base one :
  //   /karaoke/TEMP/Anime >> TEMP
  //   if anything is in the top directory, it will be indexed as such.
  const dirName = groupBySubdirectories ?
      last(directories) :
      (directories[1] || directories[0])

  const fileNamePatterns = fileName.match(REGEX_WITH_LANGUAGE) || []

  if (fileNamePatterns.length) {
    [, group, type, songName, languageString, extension] = fileNamePatterns
  } else {
    [, group, type, songName, extension] = fileName.match(REGEX_WITHOUT_LANGUAGE) || []
  }
  const isVideo = extension ? isVideoExtension(extension) : false
  const isSubtitles = extension ? isSubtitlesExtension(extension) : false
  const language = languageString && languageString.slice(1, languageString.length - 1)
  const path = `${dirPath}/${fileName}`
  // Used to match together videos and their subtitles
  const pathWithoutExtension = path.substr(path, path.lastIndexOf('.'))

  return {
    id: kebabCase(path),
    path,
    pathWithoutExtension,
    dirName,
    fileName,
    type,
    group,
    songName,
    language,
    isDir: stat.isDirectory(),
    isVideo,
    isSubtitles,
  }
}

// Gets the directory contents as a big array
function getDirectoryContents(dirPath, callback) {
  fs.readdir(dirPath, (err, filesList) => {
    if (err) return callback(err)
    async.map(filesList, (fileName, cbMap) => {
      fs.stat(`${dirPath}/${fileName}`, (err, stat) => {
        if (err) return cbMap(err)
        cbMap(null, getFileInfos(fileName, dirPath, stat))
      })
    }, (err, results) => {
      if (err) return callback(err)
      async.reduce(results, [], (previous, result, cbReduce) => {
        if (!result.isDir) return cbReduce(null, previous.concat(result))
        getDirectoryContents(result.path, (err, results) => {
          if (err) return cbReduce(err)
          return cbReduce(null, previous.concat(results))
        })
      }, callback)
    })
  })
}

function createDataDir() {
  try {
    fs.mkdirSync('./.data')
  } catch (e) {
    if (e.code !== 'EEXIST') throw new Error(`Unhandled error ${e.message}`)
  }
}

const getFormattedContent = () => new Promise((resolve, reject) => {
  getDirectoryContents(karaokeDirectory, (err, contents) => {
    if (err) return reject(err)

    const videoContents = chain(contents)
      .groupBy('pathWithoutExtension')
      .mapValues(([content1 = {}, content2 = {}]) => {
        const videoContent = [content1, content2].find(({ isVideo }) => isVideo) || {}
        const subtitlesContent = [content1, content2].find(({ isSubtitles }) => isSubtitles) || {}
        return omit(
          Object.assign(videoContent, { subtitles: subtitlesContent.path }),
          ['isDir', 'isVideo', 'isSubtitles', 'pathWithoutExtension']
        )
      })
      .filter(content => content.id)

    resolve(videoContents)
  })
})

if (require.main === module) {
  createDataDir()
  getFormattedContent()
    .then(allContents =>
      fs.writeFileSync('./.data/allContents.json', JSON.stringify(allContents, null, 2)))
    .catch(err => console.error(err))
} else {
  module.exports = getFormattedContent
}
