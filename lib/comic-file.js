// lib/comic-file.js

var path = require('path');
var fs = require('fs');

var fse = require('fs-extra');
var ua = require('unpack-all');

// var easyimg = require('easyimage');
var sharp = require('sharp');

var utils = require('jul11co-utils');

var use_sharp = true;

var comic_cache_dir = path.join(process.env['HOME'], '.jul11co', 'comic-file');
// fse.ensureDirSync(comic_cache_dir);

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

  if (use_sharp || options.sharp) {
    sharp(image_file)
      .resize(thumb_width, thumb_height)
      .toFile(thumb_file, function(err, info) {
        if (err) return callback(err);
        callback();
      });
  }
  else {
    // easyimg.thumbnail({
    //   src: image_file, 
    //   dst: thumb_file,
    //   width: thumb_width, 
    //   height: thumb_height,
    //   x:0, y:0
    // }).then(function (file) {
    //   callback();
    // }, function (err) {
    //   return callback(err);
    // });
    return callback(new Error('Not implemented'));
  }
}

exports.parse = function(comic_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var result = {};
  var comic_file_path = utils.replaceAll(comic_file, '"', '\\"');
  ua.list(comic_file_path, {quiet: true}, function(err, files, text) {
    if (err) return callback(err);
    if (files) {
      
      var pages = files.filter(function(file) {
        return /\.jpg|\.jpeg|\.png|\.gif/.test(file.toLowerCase());
      });

      pages.sort();
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
  var comic_file_path = utils.replaceAll(comic_file, '"', '\\"');
  ua.list(comic_file_path, {quiet: true}, function(err, files, text) {
    if (err) return callback(err);
    if (files) {
      
      var pages = files.filter(function(file) {
        return /\.jpg|\.jpeg|\.png|\.gif/.test(file.toLowerCase());
      });

      pages.sort();
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

  // list files in archive
  var comic_file_path = utils.replaceAll(comic_file, '"', '\\"');
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

    var pages = files.filter(function(file) {
      return /\.jpg|\.jpeg|\.png|\.gif/.test(file.toLowerCase());
    });

    pages.sort();
    // console.log('Pages', pages);

    callback(null, pages);
  });
}

exports.extractPage = function(comic_file, page_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var unpack_opts = {
    targetDir: options.targetDir || path.join(comic_cache_dir, 'tmp', path.basename(comic_file)),
    noDirectory: true,
    forceOverwrite: true,
    quiet: false
  };

  fse.ensureDirSync(unpack_opts.targetDir);

  if (options.clearTargetDir) {
    try {
      fse.emptyDirSync(unpack_opts.targetDir);
    } catch(e) {
      if (e.code !== 'ENOTEMPTY') console.log(e);
    }
  }
  
  if (!options.retry) unpack_opts.files = [page_file];
  if (options.retry) console.log('RETRY extractPage:', path.basename(comic_file));

  console.log('INFO unpack file:', path.basename(comic_file) + ' > ' + page_file);

  // unpack to get cover page
  var comic_file_path = utils.replaceAll(comic_file, '"', '\\"');
  ua.unpack(comic_file_path, unpack_opts, function(err, files, text) {
    if (err) {
      if (!options.retry) {
        console.log('ERROR: Unpack failed: ' + err.message);
        setTimeout(function() {
          options.retry = true;
          exports.extractPage(comic_file, page_file, options, callback);
        }, 0);
        return;
      }
      console.log('ERROR: Unpack comic file failed');
      console.log(err);
      return callback(err);
    }

    var page_file_path = path.join(unpack_opts.targetDir, page_file);

    callback(null, page_file_path);
  });
}

exports.generateCoverImage = function(comic_file, cover_image, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  var result = {};

  if (fileExists(cover_image)) {
    if (options.verbose) console.log('Cover page already exists');
    result.cover_image = cover_image;
    return callback(null, result);
  }

  exports.listPages(comic_file, function(err, pages) {
    if (err) {
      console.log('Extract file list from comic file failed');
      return callback(err);
    }
    if (!pages) {
      console.log('The comic file has no contents');
      return callback(new Error('No files available!'));
    }

    result.pages = pages.length;

    if (pages.length == 0) {
      console.log('ERROR: The comic file has no cover page');
      return callback(new Error('Cover page not found!'));
    }

    var cover_page = pages[0];
    if (options.verbose) console.log('Cover page:', cover_page);

    var tmpdir = options.tmpdir || path.join(comic_cache_dir, 'tmp', path.basename(comic_file));
    fse.ensureDirSync(tmpdir);
    // fse.emptyDirSync(tmpdir); // cleaned if exists, created if not exist

    var cover_file = path.join(tmpdir, cover_page);

    if (fileExists(cover_file)) {
      fse.ensureDirSync(path.dirname(cover_image));
      if (options.verbose) console.log('Cover image:', cover_image);

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
        targetDir: tmpdir,
        // clearTargetDir: true
      }, function(err) {
        if (err) {
          console.log('ERROR: Extract cover file failed');
          return callback(err);
        }

        fse.ensureDirSync(path.dirname(cover_image));
        if (options.verbose) console.log('Cover image:', cover_image);

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

  exports.listPages(comic_file, function(err, pages) {
    if (err) {
      console.log('ERROR: Extract file list from comic file failed');
      return callback(err);
    }
    if (!pages) {
      console.log('ERROR: The comic file has no contents');
      return callback(new Error('No files available!'));
    }

    result.pages = pages.length;
    if (pages.length == 0) {
      console.log('ERROR: The comic file has no cover page');
      return callback(new Error('Cover page not found!'));
    }

    var cover_page = pages[0];
    if (options.verbose) console.log('Cover page:', cover_page);

    var tmpdir = options.tmpdir || path.join(comic_cache_dir, 'tmp');
    var outdir = options.outdir || path.join(comic_cache_dir, 'covers');
    
    fse.ensureDirSync(tmpdir);
    fse.ensureDirSync(outdir);

    var comic_file_name = path.basename(comic_file);
    var targetDir = options.targetDir || path.join(tmpdir, comic_file_name[0], comic_file_name[1], 
      comic_file_name[2], comic_file_name);

    var cover_file = path.join(targetDir, cover_page);
    var cover_image = result.md5sum + path.extname(cover_file);
    var cover_image = path.join(outdir, cover_image[0], cover_image[1], cover_image[2], cover_image);
    if (options.verbose) console.log('Cover image:', cover_image);

    if (fileExists(cover_image)) {
      if (options.verbose) console.log('Cover page already exists');
      result.cover_image = cover_image;
      return callback(null, result);
    }

    fse.ensureDirSync(path.dirname(cover_image));

    // fse.emptyDirSync(tmpdir); // cleaned if exists, created if not exist

    // unpack to get cover page
    exports.extractPage(comic_file, cover_page, {
      targetDir: targetDir,
      clearTargetDir: true
    }, function(err) {
      if (err) {
        console.log('ERROR: Extract cover file failed');
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
  
  exports.listPages(comic_file, function(err, pages) {
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
      targetDir: tmpdir
    }, function(err) {
      if (err) {
        console.log('ERROR: Extract image file failed');
        return callback(err);
      }

      callback(null, page_file);      
    });
  });
}
