var path = require('path');
var fs = require('fs');
var fse = require('fs-extra');
var crypto = require('crypto');

var easyimg = require('easyimage');

var sharp = require('sharp'); // npm install sharp 

var use_sharp = true;
var using_lwip = false;
// var lwip = require('lwip'); // npm install lwip

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
  if (using_lwip) {
    lwip.open(photo_file, function(err, image){
      if (err) return callback(err);

      callback(null, {
        width: image.width(),
        height: image.height(),
        image: image
      });
    });
  } else {
    easyimg.info(photo_file).then(function(file_info) {
      // console.log(file_info);
      callback(null, file_info);
    }, function (err) {
      return callback(err);
    }); 
  }
}

exports.generateThumbImage = function(photo_file, thumb_file, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var thumb_width = options.thumb_width || 128;
  var thumb_height = options.thumb_height || 128;

  if (use_sharp || options.sharp) {
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
  else if (using_lwip) {
    if (options.image) {
      options.image.cover(thumb_width, thumb_height, function(err, image) {
        if (err) return callback(err);

        image.writeFile(thumb_file, function(err) {
          if (err) return callback(err);

          callback();
        });
      });
    } else {
      lwip.open(photo_file, function(err, image){
        if (err) return callback(err);

        image.cover(thumb_width, thumb_height, function(err, image) {
          if (err) return callback(err);

          image.writeFile(thumb_file, function(err) {
            if (err) return callback(err);

            callback();
          });
        });
      });
    }
  } else {
    easyimg.thumbnail({
      src: photo_file, 
      dst: thumb_file,
      width: thumb_width, 
      height: thumb_height,
      x:0, y:0
    }).then(function (file) {
      callback();
    }, function (err) {
      return callback(err);
    });
  }
}

exports.getInfoAndGenerateThumbImage = function(photo_file, options, callback) {
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

    if (result.width < options.min_width || result.height < options.min_height) {
      // Do not generate thumbnail
      return callback(null, result);
    }

    var outputdir = options.outputdir || path.join('.', 'photo_thumbnails');
    
    fse.ensureDirSync(outputdir);

    var thumb_ext = path.extname(photo_file);
    var thumb_file = path.basename(photo_file, thumb_ext) + thumb_ext;
    var thumb_image = path.join(outputdir, thumb_file);

    if (fileExists(thumb_image)) {
      result.thumb_image = thumb_image;
      return callback(null, result);
    }

    // Generate thumbnail
    exports.generateThumbImage(photo_file, thumb_image, {
      thumb_width: options.thumb_width || 128, 
      thumb_height: options.thumb_height || 128,
      image: file_info.image
    }, function(err) {
      if (file_info.image) file_info.image = null;

      if (err) return callback(err);

      result.thumb_file = thumb_file;
      result.thumb_image = thumb_image;

      callback(null, result);
    });
  }); // getPhotoInfo

}
