// lib/comic-file.js

var path = require('path');
var fs = require('fs');

var fse = require('fs-extra');
var ua = require('unpack-all');
var natsort = require('natsort');

var sharp = require('sharp');

var comic_cache_dir = path.join(process.env['HOME'], '.jul11co', 'comic-file');
fse.ensureDirSync(comic_cache_dir);

var escapeRegExp = function(string) {
  return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

var replaceAll = function(string, find, replace) {
  return string.replace(new RegExp(escapeRegExp(find), 'g'), replace);
}

var getUniqueArray = function(array) {
  var result_arr = [];
  if (!array || array.length == 0) return result_arr;
  array.forEach(function(item) {
    if (result_arr.indexOf(item) == -1) result_arr.push(item);
  });
  return result_arr;
}

var fileExists = function(file_path) {
  try {
    var stats = fs.statSync(file_path);
    if (stats.isFile()) {
      return true;
    }
  } catch (e) {
  }
  return false;
}

var resizeImageFile = function(image_file, thumb_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  options = options || {};

  var thumb_width = options.thumb_width || 256;
  var thumb_height = options.thumb_height; // || 256;

  sharp(image_file)
    .resize(thumb_width, thumb_height)
    .toFile(thumb_file, function(err, info) {
      if (err) return callback(err);
      callback();
    });
}

///

exports.parse = function(comic_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  var comic_file_path = replaceAll(comic_file, '"', '\\"');

  var result = {};
  ua.list(comic_file_path, {quiet: true}, function(err, files, text) {
    if (err) return callback(err);
    if (files) {
      
      files.shift();
      result.files = files;

      var pages = files.filter(function(file) {
        return /\.jpg|\.jpe|\.jpeg|\.png|\.gif/.test(file.toLowerCase());
      });

      // pages.sort();
      pages.sort(natsort());
      pages = getUniqueArray(pages);
      // console.log('Pages', pages);

      result.pages = pages.length;
      if (pages.length > 0) result.cover_page = pages[0];
    }
    callback(null, result);
  });
}

exports.getInfo = function(comic_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var stat = undefined;
  try {
    stat = fs.lstatSync(comic_file);
  } catch(e) {
    console.log(e);
    return callback(e);
  }
  if (!stat) return callback(new Error('Cannot get file stat'));

  var result = {
    name: path.basename(comic_file),
    size: stat['size']
  };

  var comic_file_path = replaceAll(comic_file, '"', '\\"');
  ua.list(comic_file_path, {quiet: true}, function(err, files, text) {
    if (err) return callback(err);
    if (files) {

      files.shift();
      result.files = files;

      var pages = files.filter(function(file) {
        return /\.jpg|\.jpe|\.jpeg|\.png|\.gif/.test(file.toLowerCase());
      });

      // pages.sort();
      pages.sort(natsort());
      pages = getUniqueArray(pages);
      // console.log('Pages', pages);

      result.pages_count = pages.length;
      result.pages = pages;
    }
    callback(null, result);
  });
}

exports.listPages = function(comic_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var comic_file_path = replaceAll(comic_file, '"', '\\"');
  // list files in archive
  ua.list(comic_file_path, {quiet: true}, function(err, files, text) {
    if (err) {
      console.log('ERROR: Extract file list from comic file failed');
      console.log(err);
      return callback(err);
    }
    if (!files) {
      console.log('ERROR: The comic file has no contents');
      return callback(new Error('No files available!'));
    }

    files.shift();

    var pages = files.filter(function(file) {
      return /\.jpg|\.jpe|\.jpeg|\.png|\.gif/.test(file.toLowerCase());
    });

    // pages.sort();
    pages.sort(natsort());
    pages = getUniqueArray(pages);
    // console.log('Pages', pages);

    callback(null, pages, files);
  });
}

exports.extractPage = function(comic_file, page_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var comic_file_path = replaceAll(comic_file, '"', '\\"');

  var unpack_opts = {
    targetDir: options.targetDir || path.join(comic_cache_dir, 'tmp', path.basename(comic_file)),
    noDirectory: true,
    forceOverwrite: true,
    // forceSkip: true,
    quiet: !options.debug
  };

  fse.ensureDirSync(unpack_opts.targetDir);

  if (options.clearTargetDir) {
    try {
      fse.emptyDirSync(unpack_opts.targetDir);
    } catch(e) {
      if (e.code !== 'ENOTEMPTY') console.log(e);
    }
  }
  
  var page_file_path = path.join(unpack_opts.targetDir, page_file);
  if (fileExists(page_file_path)) {
    return callback(null, page_file_path);
  }

  if (!options.unpack_all_files) {
    if (options.unpack_by_index) {
      if (!options.files) {
        if (options.debug || options.verbose) console.log('INFO: List files:', path.basename(comic_file));
        return exports.listPages(comic_file, options, function(err, pages, _files) {
          if (err || !_files) {
            if (options.debug || options.verbose) {
              console.log('INFO: List files:', path.basename(comic_file), 'FAILED');
            }
            options.unpack_by_index = false;
            exports.extractPage(comic_file, page_file, options, callback);
          } else {
            options.files = _files.slice();
            exports.extractPage(comic_file, page_file, options, callback);
          }
        });
      }
      // console.log('First file (index 0):', options.files[0]);
      var page_file_index = options.files.indexOf(page_file);
      // if (page_file_index >= 0) page_file_index++;
      unpack_opts.indexes = [page_file_index];
      if (options.debug || options.verbose) {
        console.log('INFO: Unpack file:', path.basename(comic_file) + ' > ' + page_file 
          + ' (by: index ' + page_file_index + ')');
      }
    } else { // unpack by file name
      unpack_opts.files = [page_file];
      if (options.debug || options.verbose) {
        console.log('INFO: Unpack file:', path.basename(comic_file) + ' > ' + page_file);
      }
    }
  } else {
    if (options.debug || options.verbose) console.log('INFO: Unpack all pages:', path.basename(comic_file));
  } 

  // console.log(unpack_opts);

  // unpack to get cover page
  ua.unpack(comic_file_path, unpack_opts, function(err, files, text) {
    if (fileExists(page_file_path)) {
      return callback(null, page_file_path);
    }

    if (!options.unpack_by_index) {
      return setTimeout(function() {
        options.unpack_by_index = true;
        exports.extractPage(comic_file, page_file, options, callback);
      }, 0);
    } else if (!options.unpack_all_files) {
      return setTimeout(function() {
        options.unpack_all_files = true;
        exports.extractPage(comic_file, page_file, options, callback);
      }, 0);
    }

    if (err) {
      console.log('ERROR: Unpack comic file failed!');
      console.log(err);
      return callback(err);
    } else {
      console.log('ERROR: Cannot unpack comic file!');
      return callback(new Error('Cannot unpack comic file!'));
    }
  });
}

exports.generateCoverImage = function(comic_file, cover_image, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  var result = {};

  if (fileExists(cover_image)) {
    if (options.debug) console.log('INFO: Cover page already exists');
    result.cover_image = cover_image;
    return callback(null, result);
  }

  exports.listPages(comic_file, function(err, pages, files) {
    if (err) {
      console.log('ERROR: Extract file list from comic file failed!');
      return callback(err);
    }
    if (!pages) {
      console.log('INFO: The comic file has no contents!', comic_file);
      return callback(new Error('No files available!'));
    }

    result.pages_count = pages.length;
    result.pages = pages;

    if (pages.length == 0) {
      console.log('ERROR: The comic file has no cover page!');
      return callback(new Error('Cover page not found!'));
    }

    var cover_page = pages[0];
    if (options.verbose) console.log('INFO: Cover page:', cover_page);

    var tmpdir = options.tmpdir || path.join(comic_cache_dir, 'tmp', path.basename(comic_file));
    fse.ensureDirSync(tmpdir);
    // fse.emptyDirSync(tmpdir); // cleaned if exists, created if not exist

    var cover_file = path.join(tmpdir, cover_page);

    if (fileExists(cover_file)) {
      fse.ensureDirSync(path.dirname(cover_image));
      if (options.verbose) console.log('INFO: Cover image:', cover_image);

      resizeImageFile(cover_file, cover_image, {
        thumb_width: options.cover_width || 240, 
        // thumb_height: options.cover_width || 320
      }, function(err) {
        if (err) return callback(err);

        // result.cover_file = cover_file;
        if (!err) result.cover_image = cover_image;

        callback(null, result);
      });
    } else {      
      // unpack to get cover page
      exports.extractPage(comic_file, cover_page, {
        files: files,
        targetDir: tmpdir,
        // clearTargetDir: true,
        debug: options.debug
      }, function(err) {
        if (err) {
          console.log('ERROR: Extract cover file failed');
          return callback(err);
        }

        fse.ensureDirSync(path.dirname(cover_image));
        if (options.verbose || options.debug) console.log('INFO: Cover image:', cover_image);

        resizeImageFile(cover_file, cover_image, {
          thumb_width: options.cover_width || 240, 
          // thumb_height: options.cover_width || 320
        }, function(err) {
          if (err) return callback(err);

          // result.cover_file = cover_file;
          if (!err) result.cover_image = cover_image;

          callback(null, result);
        });
      });
    }
  });
}

exports.parseAndExtractCoverImage = function(comic_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  var result = {};

  exports.listPages(comic_file, function(err, pages, files) {
    if (err) {
      console.log('ERROR: Extract file list from comic file failed!');
      return callback(err);
    }
    if (!pages) {
      console.log('ERROR: The comic file has no contents');
      return callback(new Error('No files available!'));
    }

    result.pages = pages;
    result.pages_count = pages.length;
    if (pages.length == 0) {
      console.log('ERROR: The comic file has no cover page');
      return callback(new Error('Cover page not found!'));
    }

    var cover_page = pages[0];
    if (options.verbose || options.debug) console.log('INFO: Cover page:', cover_page);

    var tmpdir = options.tmpdir || path.join(comic_cache_dir, 'tmp');
    var outdir = options.outdir || path.join(comic_cache_dir, 'covers');
    
    fse.ensureDirSync(tmpdir);
    fse.ensureDirSync(outdir);

    var comic_file_name = path.basename(comic_file);
    var defaultTargetDir = path.join(tmpdir, comic_file_name[0], 
      comic_file_name[1]+comic_file_name[2], comic_file_name);
    var targetDir = options.targetDir || defaultTargetDir;

    var cover_file = path.join(targetDir, cover_page);
    var cover_image = result.md5sum + path.extname(cover_file);
    var cover_image = path.join(outdir, cover_image[0], cover_image[1]+cover_image[2], cover_image);
    if (options.verbose) console.log('INFO: Cover image:', cover_image);

    if (fileExists(cover_image)) {
      if (options.verbose || options.debug) console.log('INFO: Cover page already exists');
      result.cover_image = cover_image;
      return callback(null, result);
    }

    fse.ensureDirSync(path.dirname(cover_image));

    // fse.emptyDirSync(tmpdir); // cleaned if exists, created if not exist

    // unpack to get cover page
    exports.extractPage(comic_file, cover_page, {
      files: files,
      targetDir: targetDir,
      clearTargetDir: true,
      debug: options.debug
    }, function(err) {
      if (err) {
        console.log('ERROR: Extract cover file failed!');
        return callback(err);
      }

      resizeImageFile(cover_file, cover_image, {
        thumb_width: options.cover_width || 240, 
        // thumb_height: options.cover_width || 320
      }, function(err) {
        if (err) return callback(err);

        // result.cover_file = cover_file;
        if (!err) result.cover_image = cover_image;

        callback(null, result);
      });
    });
  });
}

exports.getPage = function(comic_file, page_number, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  // console.log('getPage:', path.basename(comic_file), page_number);
  
  exports.listPages(comic_file, function(err, pages, files) {
    if (err) return callback(err);
    if (!pages) {
      return callback(new Error('No files available!'));
    }

    if (pages.length == 0) {
      console.log('ERROR: The comic file has no pages');
      return callback(new Error('Comic file has no pages!'));
    }
    if (pages.length <= page_number) {
      console.log('ERROR: The comic file has no specified page (page out of range)');
      return callback(new Error('Page out of range'));
    }

    var tmpdir = options.tmpdir || path.join(comic_cache_dir, 'reading');
    tmpdir = path.join(tmpdir, path.basename(comic_file));

    var page_image = pages[page_number];
    var page_file = path.join(tmpdir, page_image);

    if (fileExists(page_file)) {
      return callback(null, page_file);
    }

    // fse.emptyDirSync(tmpdir); // cleaned if exists, created if not exist

    exports.extractPage(comic_file, page_image, {
      files: files,
      targetDir: tmpdir,
      debug: options.debug,
      verbose: options.verbose
    }, function(err) {
      if (err) {
        console.log('ERROR: Extract image file failed!');
        return callback(err);
      }

      callback(null, page_file);      
    });
  });
}
