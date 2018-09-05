// lib/photo-file.js

var path = require('path');
var fs = require('fs');
var fse = require('fs-extra');

var sharp = require('sharp');

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

exports.getPhotoInfo = function(photo_file, callback) {
  var image = sharp(photo_file);
  image.metadata()
    .then(function(metadata) {
      callback(null, metadata);
    }, function(err) {
      return callback(err);
    });
}

exports.generateThumbImage = function(photo_file, thumb_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var thumb_width = options.thumb_width || 128;
  var thumb_height = options.thumb_height;// || 128;

  fs.readFile(photo_file, function(err, photo_buff) {
    if (err) return callback(err);
    
    sharp(photo_buff)
      .resize(thumb_width, thumb_height)
      .toFile(thumb_file, function(err, info) {
        if (err) return callback(err);
        callback();
      });
  });
}

exports.getInfoAndGenerateThumbImage = function(photo_file, thumb_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  var result = {};

  exports.getPhotoInfo(photo_file, function(err, file_info) {
    if (err) return callback(err);

    // console.log(file_info);

    result.name = file_info.name;

    result.type = file_info.type;
    result.size = file_info.size;
    result.width = file_info.width;
    result.height = file_info.height;
    result.depth = file_info.depth;
    result.density = file_info.density;

    if ((result.width && options.min_width && result.width < options.min_width) || 
      (result.height && options.min_height && result.height < options.min_height)) {
      // Do not generate thumbnail
      return callback(null, result);
    }

    if (fileExists(thumb_file)) {
      result.thumb_file = thumb_file;
      return callback(null, result);
    }

    // Generate thumbnail
    exports.generateThumbImage(photo_file, thumb_file, {
      thumb_width: options.thumb_width || 128, 
      // thumb_height: options.thumb_height || 128,
    }, function(err) {
      if (err) return callback(err);

      result.thumb_file = thumb_file;
      callback(null, result);
    }); // generateThumbImage
  }); // getPhotoInfo
}
