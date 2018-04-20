#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var urlutil = require('url');

var async = require('async');
var fse = require('fs-extra');
var chalk = require('chalk');
var moment = require('moment');

var bytes = require('bytes');
var open = require('open');
var natsort = require('natsort');
var Fuse = require('fuse.js');

var JsonStore = require('jul11co-wdt').JsonStore;
var JobQueue = require('jul11co-wdt').JobQueue;

var downloader = require('jul11co-wdt').Downloader;

var utils = require('jul11co-utils');

var comicFile = require('./lib/comic-file');
var photoFile = require('./lib/photo-file');

var package = require('./package.json');

function printUsage() {
  console.log('Usage: mangabrowser <data-dir> [<data-dir-2>...] [OPTIONS]');
  console.log('       mangabrowser -i, --index /path/to/files.json [data-dir] [OPTIONS]');
  console.log('');
  console.log('OPTIONS:');
  console.log('     --verbose                   : verbose');
  console.log('     --check-exists              : check for file/folder existences');
  console.log('     --no-thumbs                 : do not generate thumbnals');
  console.log('');
}

if (process.argv.indexOf('-h') >= 0 
  || process.argv.indexOf('--help') >= 0
  || process.argv.length < 3) {
  printUsage();
  process.exit();
}

var options = {};
var argv = [];
for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] == '--index' || process.argv[i] == '-i') {
    options.index_file = process.argv[i+1];
    i++;
  } else if (process.argv[i].indexOf('--') == 0) {
    var arg = process.argv[i];
    if (arg.indexOf("=") > 0) {
      var arg_kv = arg.split('=');
      arg = arg_kv[0];
      arg = arg.replace('--','');
      arg = utils.replaceAll(arg, '-', '_');
      options[arg] = arg_kv[1];
    } else {
      arg = arg.replace('--','');
      arg = utils.replaceAll(arg, '-', '_');
      options[arg] = true;
    }
  } else {
    argv.push(process.argv[i]);
  }
}

// console.log(options);

if (argv.length < 1 && !options.index_file) {
  printUsage();
  process.exit();
}

process.on('SIGINT', function() {
  console.log("\nCaught interrupt signal");
  process.exit();
});

var data_dir = argv[0]; // default
var data_dirs = [];
var abs_path_mode = false;

if (options.index_file) {
  data_dir = argv[0] || path.dirname(options.index_file);
  console.log('Index file:', options.index_file);
} else if (argv.length > 1) {
  abs_path_mode = true;
  data_dirs = argv.map(function(dir) {
    return path.resolve(dir);
  });
  console.log('Input directories (' + data_dirs.length + '):');
  data_dirs.forEach(function(dir) {
    console.log('  - ' + dir);
  });
} else {
  data_dir = path.resolve(data_dir);
  console.log('Input directory:', data_dir);
}

var getAbsPath = function(relpath) {
  if (abs_path_mode) {
    return relpath;
  } else {
    return path.join(data_dir, relpath);
  }
}

var getRelPath = function(abspath) {
  if (abs_path_mode) {
    return abspath;
  } else {
    return (abspath == data_dir) ? '.' : path.relative(data_dir, abspath);
  }
}

var isRootPath = function(abspath) {
  if (abs_path_mode) {
    return data_dirs.indexOf(abspath) != -1;
  } else {
    return abspath == data_dir;
  }
}

var config = {
  thumbnals: !(options.no_thumbs)
};

var all_dirs = [];

var dirs_map = {};
var files_map = {};

var IMAGE_FILE_TYPES = ['jpg','jpeg','png','gif'];
var VIDEO_FILE_TYPES = ['mp4','webm'];
var COMIC_FILE_TYPES = ['cbz','cbr','zip'];

var file_types_map = {};
var popular_file_types = [];

var image_files = [];
var video_files = [];
var all_files = [];

var manga_list = [];
var manga_map = {};
var manga_chapters_map = {};

var manga_searcher = false;
var manga_search_opts = {
  shouldSort: true,
  matchAllTokens: true,
  includeScore: false,
  threshold: 0.2,
  location: 0,
  distance: 200,
  maxPatternLength: 32,
  minMatchCharLength: 1,
  keys: [
    "name"
  ]
};
var manga_search_list = [];
var manga_search_recent = [];

var manga_indices = {};
var manga_filters = [
  {param: 'status',    title: 'Status',     index: 'status',     field: 'status',     data_type: 'string',       hyphen: true, icon: '<i class="fa fa-check-square-o fa-fw"></i>'},
  {param: 'language',  title: 'Language',   index: 'language',   field: 'language',   data_type: 'string',       hyphen: true, icon: '<i class="fa fa-globe fa-fw"></i>'},
  {param: 'category',  title: 'Categories', index: 'categories', field: 'categories', data_type: 'string_array', hyphen: true, icon: '<i class="fa fa-inbox fa-fw"></i>'},
  {param: 'genre',     title: 'Genres',     index: 'genres',     field: 'genres',     data_type: 'string_array', hyphen: true, icon: '<i class="fa fa-tags fa-fw"></i>'},
  {param: 'tag',       title: 'Tags',       index: 'tags',       field: 'tags',       data_type: 'string_array', hyphen: true, icon: '<i class="fa fa-tags fa-fw"></i>'},
  {param: 'author',    title: 'Authors',    index: 'authors',    field: 'authors',    data_type: 'string_array', hyphen: true, icon: '<i class="fa fa-users fa-fw"></i>'},
  {param: 'artist',    title: 'Artists',    index: 'artists',    field: 'artists',    data_type: 'string_array', hyphen: true, icon: '<i class="fa fa-users fa-fw"></i>'},
  {param: 'parody',    title: 'Parodies',   index: 'parodies',   field: 'parodies',   data_type: 'string_array', hyphen: true, icon: '<i class="fa fa-book fa-fw"></i>'},
  {param: 'character', title: 'Characters', index: 'characters', field: 'characters', data_type: 'string_array', hyphen: true, icon: '<i class="fa fa-users fa-fw"></i>'}
];

var manga_field_filter_map = {};
manga_filters.forEach(function(manga_filter) {
  manga_field_filter_map[manga_filter.field] = manga_filter;
});

var manga_starts_with_map = {};
var manga_starts_with_list = [];

if (options.listen_port) {
  options.listen_port = parseInt(options.listen_port);
  if (isNaN(options.listen_port)) {
    console.log('Invalid listern port: ' + options.listen_port);
    process.exit();
  }
}

var cache_dir = path.join(process.env['HOME'], '.jul11co', 'mangabrowser', 'cache');
fse.ensureDirSync(cache_dir);
var thumbs_dir = path.join(process.env['HOME'], '.jul11co', 'mangabrowser', 'thumbs');
fse.ensureDirSync(thumbs_dir);
var db_dir = path.join(process.env['HOME'], '.jul11co', 'mangabrowser', 'databases');
fse.ensureDirSync(db_dir);
fse.ensureDirSync(path.join(db_dir, utils.md5Hash(data_dir)));

var chapter_read_store = new JsonStore({file: path.join(db_dir, utils.md5Hash(data_dir), 'chapter_read.json')});

var listen_port = options.listen_port || 31128;

function isChapterRead(chapter_url) {
  return chapter_read_store.get(utils.md5Hash(chapter_url));
}

function setChapterRead(chapter_url, read_info) {
  chapter_read_store.set(utils.md5Hash(chapter_url), read_info || {last_read: new Date()});
}

function ellipsisMiddle(str, max_length, first_part, last_part) {
  if (!max_length) max_length = 140;
  if (!first_part) first_part = 40;
  if (!last_part) last_part = 20;
  if (str.length > max_length) {
    return str.substr(0, first_part) + '...' + str.substr(str.length-last_part, str.length);
  }
  return str;
}

var scanDir = function(dir_path, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  // console.log(chalk.magenta('Directory:'), ellipsisMiddle(dir_path));

  var dirlist = [];
  var filelist = [];

  fs.readdir(dir_path, function(err, files) {
    if (err) return callback(err);

    async.eachSeries(files, function(file, cb) {
      
      if (file == '.DS_Store') return cb();

      var file_path = path.join(dir_path, file);

      var stats = undefined;
      try {
        stats = fs.lstatSync(file_path);
      } catch(e) {
        console.log(e);
        return cb();
      }
      if (!stats) return cb();
      
      // console.log(stats);
      if (stats.isFile()) {
        if (file.indexOf('.') == 0) {
          return cb();
        }
        
        if (options.min_file_size && stats['size'] < min_file_size) return cb();

        var file_type = path.extname(file).replace('.','').toLowerCase();
        if (options.file_types && options.file_types.indexOf(file_type) == -1) return cb();

        var file_info = {
          path: file_path,
          name: file,
          type: file_type,
          size: stats['size'],
          atime: stats['atime'],
          mtime: stats['mtime'],
          ctime: stats['ctime']
        };

        filelist.push(file_info);
        cb();
      } else if (stats.isDirectory() && options.recursive) {

        dirlist.push({
          path: file_path,
          name: file,
          atime: stats['atime'],
          mtime: stats['mtime'],
          ctime: stats['ctime']
        });

        scanDir(file_path, options, function(err, files, dirs) {
          if (err) return cb(err);

          filelist = filelist.concat(files);
          dirlist = dirlist.concat(dirs);

          cb();
        });
      } else {
        cb();
      }
    }, function(err) {
      callback(err, filelist, dirlist);
    });
  });
}

var getParentDirs = function(_path) {
  var parents = [];
  if (isRootPath(_path)) {
    parents.push('ROOT');
    return parents;
  }
  var parent = path.dirname(_path);
  if (parent && parent != '' && parent != '.') {
    var _parents = getParentDirs(parent);
    if (_parents.length) parents = parents.concat(_parents);
    parents.push(parent);
  } 
  // else if (parent == '.') {
  //   parents.push(parent);
  // }
  return parents;
}

var sortItems = function(items, field, order) {
  if (order == 'desc') {
    var sorter = natsort({ desc: true });
    items.sort(function(a,b) {
      // if (a[field] > b[field]) return -1;
      // if (a[field] < b[field]) return 1;
      // return 0;
      return sorter(a[field], b[field]);
    });
  } else {
    var sorter = natsort();
    items.sort(function(a,b) {
      // if (a[field] > b[field]) return 1;
      // if (a[field] < b[field]) return -1;
      // return 0;
      return sorter(a[field], b[field]);
    });
  }
}

var checkDirExists = function(dir_path, exists_map) {
  exists_map = exists_map || {};
  if (dir_path == '/') return true;
  if (typeof exists_map[dir_path] != 'undefined') {
    return exists_map[dir_path];
  }
  if (!checkDirExists(path.dirname(dir_path), exists_map)) {
    exists_map[dir_path] = false;
    return false;
  }
  var exists = utils.directoryExists(dir_path);
  exists_map[dir_path] = exists;
  return exists;
}

var checkFileExists = function(file_path, exists_map) {
  exists_map = exists_map || {};
  if (!checkDirExists(path.dirname(file_path), exists_map)) {
    return false;
  }
  return utils.fileExists(file_path);
}

var startServer = function() {
  var express = require('express');
  var session = require('express-session');

  var app = express();

  // view engine setup
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.use(session({
    secret: 'jul11co-mangabrowser',
    resave: true,
    saveUninitialized: true
  }));
  app.use(express.static(path.join(__dirname, 'public')))

  app.get('/info', function(req, res) {
    return res.json({
      name: 'MangaBrowser',
      version: package.version,
      data_dir: path.resolve(data_dir)
    });
  });

  // GET /?dir=...
  // GET /?files=1
  // GET /?images=1
  // GET /?videos=1
  // GET /?file_type=...
  var fileBrowser = function(req, res) {
    var dirs = [];
    var files = [];

    var dir_path = req.query.dir ? decodeURIComponent(req.query.dir) : '.';
    if (abs_path_mode && dir_path == '.') dir_path = 'ROOT';
    var total_size = 0;

    var parents = [];
    if (req.query.from_dir) {
      req.query.from_dir = decodeURIComponent(req.query.from_dir);
      dir_path = req.query.from_dir;
    }

    if (dir_path != '.' && dir_path != 'ROOT') {
      var dir_parents = getParentDirs(dir_path);
      parents = dir_parents.map(function(parent_path) {
        return {path: parent_path, name: path.basename(parent_path)};
      });
    }

    // console.log('Path:', dir_path);
    if (req.query.images) {
      if (req.query.from_dir) {
        var matched_image_files = image_files.filter(function(file_relpath) {
          return file_relpath.indexOf(req.query.from_dir) == 0;
        });
        files = matched_image_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      } else {
        files = image_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      }
    } 
    else if (req.query.videos) {
      if (req.query.from_dir) {
        var matched_video_files = video_files.filter(function(file_relpath) {
          return file_relpath.indexOf(req.query.from_dir) == 0;
        });
        files = matched_video_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      } else {
        files = video_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      }
    }
    else if (req.query.files) {
      if (req.query.from_dir) {
        var matched_files = all_files.filter(function(file_relpath) {
          return file_relpath.indexOf(req.query.from_dir) == 0;
        });
        files = matched_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      } else {
        files = all_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      }
    }
    else if (req.query.file_type) {
      if (req.query.from_dir) {
        var matched_files = file_types_map[req.query.file_type].files.filter(function(file_relpath) {
          return file_relpath.indexOf(req.query.from_dir) == 0;
        });
        files = matched_files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      } else {
        files = file_types_map[req.query.file_type].files.map(function(file_relpath) {
          return files_map[file_relpath];
        });
      }
    }
    else if (dir_path && dirs_map[dir_path]) {
      var dir_entry = dirs_map[dir_path];
      dirs = dir_entry.subdirs.map(function(dir_relpath) {
        return {
          name: dirs_map[dir_relpath].name,
          path: dirs_map[dir_relpath].path,
          size: dirs_map[dir_relpath].size,
          atime: dirs_map[dir_relpath].atime,
          mtime: dirs_map[dir_relpath].mtime,
          ctime: dirs_map[dir_relpath].ctime,
          subdirs_count: dirs_map[dir_relpath].subdirs.length,
          files_count: dirs_map[dir_relpath].files.length
        }
      });
      files = dir_entry.files.map(function(file_relpath) {
        return files_map[file_relpath];
      });
    }

    var dir_file_types = [];
    var dir_file_types_map = {};
    
    if (req.query.from_dir) {
      files.forEach(function(file) {
        if (file.type && file.type != '') {
          if (!dir_file_types_map[file.type]) {
            dir_file_types_map[file.type] = {};
            dir_file_types_map[file.type].count = 0;
            dir_file_types_map[file.type].files = [];
          }
          dir_file_types_map[file.type].count++;
        }
      });
      for(var file_type in dir_file_types_map) {
        dir_file_types.push({
          type: file_type, 
          count: dir_file_types_map[file_type].count
        });
      }
      dir_file_types.sort(function(a,b) {
        if (a.count>b.count) return -1;
        if (a.count<b.count) return 1;
        return 0;
      });
    }

    dirs.forEach(function(dir){ total_size += dir.size || 0; });
    files.forEach(function(file) { total_size += file.size || 0; })

    var query = Object.assign({}, req.query);

    // console.log('Dirs:', dirs.length);
    // console.log('Files:', files.length);
    if (query.sort == 'size') {
      sortItems(dirs, 'size', query.order || 'desc');
      sortItems(files, 'size', query.order || 'desc');
      if (req.session) {
        req.session.sort = query.sort;
        req.session.order = query.order || 'desc';
      }
    } else if (query.sort == 'mtime') {
      sortItems(dirs, 'mtime', query.order || 'desc');
      sortItems(files, 'mtime', query.order || 'desc');
      if (req.session) {
        req.session.sort = query.sort;
        req.session.order = query.order || 'desc';
      }
    } else if (query.sort == 'type') {
      sortItems(files, 'type', query.order || 'asc');
      if (req.session) {
        req.session.sort = query.sort;
        req.session.order = query.order || 'asc';
      }
    } else if (query.sort != 'name' && req.session.sort) {
      // console.log(req.session.sort, req.session.order);
      sortItems(dirs, req.session.sort, query.order || req.session.order);
      sortItems(files, req.session.sort, query.order || req.session.order);
      query.sort = req.session.sort;
      query.order = query.order || req.session.order;
    } else {
      sortItems(dirs, 'name', query.order || 'asc');
      sortItems(files, 'name', query.order || 'asc');
      if (req.session) {
        delete req.session.sort;
        delete req.session.order;
      }
    }

    query.limit = query.limit ? parseInt(query.limit) : 100;
    query.skip = query.skip ? parseInt(query.skip) : 0;
    
    // var start_index = Math.min(query.skip, files.length);
    // var end_index = Math.min(query.skip + query.limit, files.length);
    // var files_length = files.length;
    // files = files.slice(start_index, end_index);

    var dirs_length = dirs.length;
    var files_length = files.length;
    var items_length = dirs_length + files_length;
    var start_index = Math.min(query.skip, items_length);
    var end_index = Math.min(query.skip + query.limit, items_length);

    // console.log('Dirs: ' + dirs_length + ', Files: ' + files_length);
    // console.log('Total: ' + items_length + ', Start: ' + start_index + ', End: ' + end_index);

    if (start_index < dirs.length && end_index < dirs.length) {
      dirs = dirs.slice(start_index, end_index);
      files = [];
    } else if (start_index < dirs.length && end_index >= dirs.length) {
      dirs = dirs.slice(start_index); // till end
      files = files.slice(0, end_index-dirs.length);
    } else { // start_index > dirs.length
      dirs = [];
      files = files.slice(start_index-dirs.length, end_index-dirs.length);
    }
    
    if (options.check_exists) {
      var exists_map = {};
      dirs.forEach(function(dir) {
        dir.missing = !checkDirExists(getAbsPath(dir.path), exists_map);
      });
      files.forEach(function(file) {
        file.missing = !checkFileExists(getAbsPath(file.relpath), exists_map);
      });
    }

    res.render('file-browser', {
      config: config,
      query: query,
      parents: parents,
      dir_path: dir_path,
      dir_name: path.basename(dir_path),
      dir_file_types: dir_file_types,
      manga: manga_map[dir_path], // reference to manga of same dir
      total_size: total_size,
      items_length: items_length,
      dirs: dirs,
      dirs_length: dirs_length,
      files: files,
      files_length: files_length,
      manga_count: manga_list.length,
      files_count: all_files.length,
      images_count: image_files.length,
      videos_count: video_files.length,
      popular_file_types: popular_file_types,
      path: path,
      bytes: bytes,
      moment: moment,
      ellipsisMiddle: ellipsisMiddle,
      utils: utils
    });
  };

  var mangaBrowser = function(req, res) {

    var query = Object.assign({}, req.query);

    var manga_relpath = decodeURIComponent(query.manga);
    console.log('Load manga:', manga_relpath);
    var manga = Object.assign({}, manga_map[manga_relpath]);

    if (!manga_searcher) {
      manga_searcher = new Fuse(manga_search_list, manga_search_opts);
    }

    // console.log('Manga name:', manga.name);
    var related_manga_list = manga_searcher.search(manga.name);
    related_manga_list = related_manga_list.filter(function(related_manga) {
      return related_manga.relpath != manga_relpath;
    });
    // console.log('Related:', related_manga_list.length);
    if (related_manga_list.length > 20) {
      related_manga_list = related_manga_list.slice(0, 20);
    }
    related_manga_items = related_manga_list.map(function(related_manga) {
      return manga_map[related_manga.relpath];
    });
    manga.related = related_manga_items;
    
    var parents = [];
    if (manga_relpath != '.' && manga_relpath != 'ROOT') {
      var manga_parents = getParentDirs(manga_relpath);
      parents = manga_parents.map(function(parent_path) {
        return {path: parent_path, name: path.basename(parent_path)};
      });
    }

    if (manga.chapters) {
      manga.chapters.forEach(function(chapter) {
        if (chapter.url && isChapterRead(chapter.url)) {
          chapter.read = true;
        }
      });
    }

    res.render('manga-browser', {
      config: config,
      query: query,
      manga_search_recent: manga_search_recent,
      scope: 'manga_info',
      parents: parents,
      files_count: all_files.length,
      manga_items: [],
      items_count: 0,
      manga: manga,
      manga_count: manga_list.length,
      manga_indices: manga_indices,
      manga_filters: manga_filters,
      manga_field_filter_map: manga_field_filter_map,
      manga_starts_with_list: manga_starts_with_list,
      path: path,
      bytes: bytes,
      moment: moment,
      ellipsisMiddle: ellipsisMiddle,
      utils: utils
    });
  }

  // GET /
  app.get('/', function(req, res) {
    if (req.query.dir || req.query.files || req.query.images || req.query.videos || req.query.file_type) {
      return fileBrowser(req, res);
    } else if (req.query.manga && req.query.manga != '.') {
      return mangaBrowser(req, res);
    } else if (req.query.view) {
      return res.render('manga-browser', {
        config: config,
        scope: 'manga_list',
        query: req.query,
        manga_search_recent: manga_search_recent,
        files_count: all_files.length,
        manga_items: [],
        items_count: 0,
        manga: {},
        manga_count: manga_list.length,
        manga_indices: manga_indices,
        manga_filters: manga_filters,
        manga_field_filter_map: manga_field_filter_map,
        manga_starts_with_list: manga_starts_with_list,
        path: path,
        bytes: bytes,
        moment: moment,
        ellipsisMiddle: ellipsisMiddle,
        utils: utils
      });
    }

    var query = Object.assign({}, req.query);

    var manga_items = [];

    if (query.search) {
      if (!manga_searcher) {
        manga_searcher = new Fuse(manga_search_list, manga_search_opts);
      }

      // console.log('Search:', query.search);
      var matched_manga_list = manga_searcher.search(query.search);
      // console.log('Found:', matched_manga_list.length);

      if (manga_search_recent.length > 10) {
        manga_search_recent.pop();
      }
      if (manga_search_recent.indexOf(query.search) != 0) {
        manga_search_recent.unshift(query.search);
      }
      
      manga_items = matched_manga_list.map(function(matched_manga) {
        return manga_map[matched_manga.relpath];
      });
    } else {
      manga_items = manga_list.map(function(manga_relpath) {
        return manga_map[manga_relpath];
      });
    }

    if (query.from_dir) {
      query.from_dir = decodeURIComponent(query.from_dir);

      manga_items = manga_items.filter(function(manga_item) {
        return manga_item.relpath.indexOf(query.from_dir) == 0;
      });
    }

    if (req.query.starts_with) {
      var starts_with_uc = req.query.starts_with.toUpperCase();
      manga_items = manga_items.filter(function(manga_item) {
        return manga_item.first_letter == starts_with_uc;
      });
    }
    manga_filters.forEach(function(manga_filter) {
      if (req.query[manga_filter.param]) {
        var query_field = manga_filter.field;
        var query_value = req.query[manga_filter.param];
        var is_string_array = manga_filter.data_type == 'string_array';
        manga_items = manga_items.filter(function(manga_item) {
          if (is_string_array) {
            return manga_item[query_field] && manga_item[query_field].indexOf(query_value) >= 0;
          } else {
            return manga_item[query_field] == query_value;
          }
          return false;
        });
      }
    });

    if (query.mangasort == 'url') {
      sortItems(manga_items, 'url', query.mangaorder || 'asc');
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'asc';
      }
    } else if (query.mangasort == 'last_update') {
      sortItems(manga_items, 'last_update', query.mangaorder || 'desc');
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'desc';
      }
    } else if (query.mangasort == 'chapters_count') {
      sortItems(manga_items, 'chapters_count', query.mangaorder || 'desc');
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'desc';
      }
    } else if (query.mangasort) {
      sortItems(manga_items, query.mangasort, query.mangaorder || 'desc');
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'desc';
      }
    } else if (query.mangasort != 'name' && req.session.mangasort) {
      sortItems(manga_items, req.session.mangasort, query.mangaorder || req.session.mangaorder);
      query.mangasort = req.session.mangasort;
      query.mangaorder = query.mangaorder || req.session.mangaorder;
    } else {
      sortItems(manga_items, 'name', query.mangaorder || 'asc');
      if (req.session) {
        delete req.session.mangasort;
        delete req.session.mangaorder;
      }
    }

    if (query.listview) {
      if (req.session) req.session.listview = query.listview;
    } else if (req.session) {
      query.listview = req.session.listview;
    }

    query.limit = query.limit ? parseInt(query.limit) : 100;
    query.skip = query.skip ? parseInt(query.skip) : 0;
    
    var start_index = Math.min(query.skip, manga_items.length);
    var end_index = Math.min(query.skip + query.limit, manga_items.length);
    var items_count = manga_items.length;
    manga_items = manga_items.slice(start_index, end_index);

    // TODO: replace with home
    res.render('manga-browser', {
      config: config,
      scope: 'manga_list',
      query: query,
      manga_search_recent: manga_search_recent,
      files_count: all_files.length,
      manga_items: manga_items,
      items_count: items_count,
      manga: {},
      manga_count: manga_list.length,
      manga_indices: manga_indices,
      manga_filters: manga_filters,
      manga_field_filter_map: manga_field_filter_map,
      manga_starts_with_list: manga_starts_with_list,
      path: path,
      bytes: bytes,
      moment: moment,
      ellipsisMiddle: ellipsisMiddle,
      utils: utils
    });
  });

  app.get('/reload_index', function(req, res) {
    reloadIndex(function(err) {
      if (err) return res.status(500).send({error: err.message});
      res.redirect('/');
    });
  });

  // GET /open?path=...
  app.get('/open', function(req, res) {
    var fpath = getAbsPath(decodeURIComponent(req.query.path));
    open(fpath);
    return res.json({ok: 1});
  });

  var updateParentDirSize = function(frelpath) {
    var parent_dirs = getParentDirs(frelpath);
    if (parent_dirs && parent_dirs.length) {
      console.log(parent_dirs);
      var dir_size_map = {};
      parent_dirs.forEach(function(parent_dir) {
        if (dirs_map[parent_dir]) {
          dirs_map[parent_dir].size = getDirSize(parent_dir, dir_size_map);
        }
      });
    }
  }

  // POST /delete/path=...
  app.post('/delete', function(req, res) {
    var frelpath = decodeURIComponent(req.query.path);
    var fpath = getAbsPath(frelpath);

    console.log('Delete path:', fpath);
    if (utils.fileExists(fpath)) {
      console.log('Delete file:', fpath);
      fse.remove(fpath, function(err) {
        if (err) {
          console.log(err);
          return res.status(500).send({error: err.message});
        }
        // update file map & parent folder sizes
        if (files_map[frelpath]) {
          var parent_path = path.dirname(frelpath);
          if (dirs_map[parent_path]) {
            dirs_map[parent_path].files = dirs_map[parent_path].files.filter(function(file_relpath) {
              return file_relpath != frelpath;
            });
          }
          updateParentDirSize(frelpath);
        }
        
        res.json({deleted: 1, type: 'file', abs_path: fpath});
      });
    } else if (utils.directoryExists(fpath)) {
      console.log('Delete folder:', fpath);
      fse.remove(fpath, function(err) {
        if (err) {
          console.log(err);
          return res.status(500).send({error: err.message});
        }
        // update file map & parent folder sizes
        if (dirs_map[frelpath]) {
          delete dirs_map[frelpath];
          var parent_path = path.dirname(frelpath);
          if (dirs_map[parent_path]) {
            dirs_map[parent_path].subdirs = dirs_map[parent_path].subdirs.filter(function(file_relpath) {
              return file_relpath != frelpath;
            });
          }
          updateParentDirSize(frelpath);
        }
        res.json({deleted: 1, type: 'folder', abs_path: fpath});
      });
    } else {
      return res.status(400).send({error: 'Path not exist'});
    }
  });

  var getFile = function(req, res) {
    var filepath = getAbsPath(decodeURIComponent(req.query.path));
    return res.sendFile(filepath);
  }

  // GET /file?path=...
  app.get('/file', getFile);
  app.get('/files/:filename', getFile);

  var stat_map = {};

  // GET /video?path=...
  app.get('/video', function(req, res) {
    var filepath = getAbsPath(decodeURIComponent(req.query.path));
    if (!stat_map[filepath]) {
      stat_map[filepath] = fs.statSync(filepath);
    }
    var stat = stat_map[filepath];
    var fileSize = stat.size
    var range = req.headers.range

    if (range) {
      var parts = range.replace(/bytes=/, "").split("-")
      var start = parseInt(parts[0], 10)
      var end = parts[1]
        ? parseInt(parts[1], 10)
        : fileSize-1

      var chunksize = (end-start)+1
      var file = fs.createReadStream(filepath, {start, end})
      var head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      }

      if (path.extname(filepath) == '.webm') {
        head['Content-Type'] = 'video/webm';
      }

      res.writeHead(206, head)
      file.pipe(res)
    } else {
      var head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      }
      if (path.extname(filepath) == '.webm') {
        head['Content-Type'] = 'video/webm';
      }
      res.writeHead(200, head)
      fs.createReadStream(filepath).pipe(res)
    }
  });

  var comic_cache = {};

  // GET /comic?path=...
  // GET /comic?path=...&info=true
  // GET /comic?path=...&page=NUM
  app.get('/comic', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    var filepath = getAbsPath(decodeURIComponent(req.query.path));
    var filepath_hash = utils.md5Hash(filepath);
    
    if (req.query.page) {
      var page_num = parseInt(req.query.page);
      if (isNaN(page_num)) return res.status(400).send({error: 'Invalid page number'});

      var extractPage = function(page_file_name) {
        comicFile.extractPage(filepath, page_file_name, {
          targetDir: path.join(cache_dir, 'contents', filepath_hash[0], 
            filepath_hash[1]+filepath_hash[2], filepath_hash)
        }, function(err, page_file_path) {
          if (err) return res.status(500).send({error: 'Extract page failed! ' + err.message});
          if (!page_file_path) return res.status(500).send({error: 'Cannot extract page!'});

          res.sendFile(page_file_path);
        });
      }

      if (comic_cache[filepath_hash] && comic_cache[filepath_hash]['pages'] 
        && comic_cache[filepath_hash]['pages'].length>page_num) {
        return extractPage(comic_cache[filepath_hash]['pages'][page_num]);
      } else {
        comicFile.getInfo(filepath, function(err, result) {
          if (err) return res.status(500).send({error: 'Get file info failed! ' + err.message});
          if (!result) return res.status(500).send({error: 'Cannot get file info!'});

          comic_cache[filepath_hash] = result;
          return extractPage(result['pages'][page_num]);
        });
      }
    } else {

      if (manga_chapters_map[filepath_hash] && manga_chapters_map[filepath_hash].url) {
        setChapterRead(manga_chapters_map[filepath_hash].url);
      }

      if (comic_cache[filepath_hash]) return res.json(comic_cache[filepath_hash]);

      comicFile.getInfo(filepath, function(err, result) {
        if (err) return res.status(500).send({error: 'Get file info failed! ' + err.message});
        if (!result) return res.status(500).send({error: 'Cannot get file info!'});
        
        // console.log(result);

        comic_cache[filepath_hash] = result;
        return res.json(result);
      });
    }
  });

  // GET /manga_chapter?path=...
  // GET /manga_chapter?path=...&page=NUM
  app.get('/manga_chapter', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    var chapterpath = decodeURIComponent(req.query.path);
    var chapterpath_abs = getAbsPath(chapterpath);

    console.log('Chapter: ' + chapterpath);
    var chapterpath_hash = utils.md5Hash(chapterpath);

    if (req.query.page) {
      var page_num = parseInt(req.query.page);
      if (isNaN(page_num)) return res.status(400).send({error: 'Invalid page number'});

      if (manga_chapters_map[chapterpath_hash] && manga_chapters_map[chapterpath_hash]['pages'] 
        && manga_chapters_map[chapterpath_hash]['pages'].length>page_num) {
        var page_file = manga_chapters_map[filepath_hash]['pages'][page_num].file;

        if (page_file && utils.fileExists(path.join(chapterpath_abs, page_file))) {
          return res.sendFile(path.join(chapterpath_abs, page_file));
        }
        
        var page_src = manga_chapters_map[filepath_hash]['pages'][page_num].src;
        return res.redirect('/image?src=' + encodeURIComponent(page_src) + '&reader=1');
      } else {
        return res.status(404).send({error: 'Missing page: ' + page_num});
      }
    } else {
      if (!manga_chapters_map[chapterpath_hash]) {
        return res.status(404).send({error: 'Chapter not found: ' + chapterpath});
      }

      if (manga_chapters_map[chapterpath_hash].url) {
        setChapterRead(manga_chapters_map[chapterpath_hash].url)
      }

      return res.json(manga_chapters_map[chapterpath_hash]);
    }
  });

  // GET /thumb?path=...
  app.get('/thumb', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    var filepath = getAbsPath(decodeURIComponent(req.query.path));
    var filepath_hash = utils.md5Hash(filepath);
    
    var thumb_filepath = path.join(thumbs_dir, filepath_hash[0], 
      filepath_hash[1]+filepath_hash[2], filepath_hash);

    fse.ensureDirSync(path.dirname(thumb_filepath));

    if (utils.fileExists(thumb_filepath)) {
      return res.sendFile(thumb_filepath);
    }

    var fileext = path.extname(filepath);
    if (fileext.indexOf('.') == 0) fileext = fileext.replace('.','');

    if (COMIC_FILE_TYPES.indexOf(fileext) != -1) {
      comicFile.generateCoverImage(filepath, thumb_filepath, {
        tmpdir: path.join(cache_dir, 'contents', filepath_hash[0], 
          filepath_hash[1]+filepath_hash[2], filepath_hash),
        cover_width: 60,
        cover_height: 60
      }, function(err, result) {
        if (err) return res.status(500).send({error: 'Generate thumb failed! ' + err.message});
        if (!result || !result.cover_image) return res.status(500).send({error: 'Cannot generate thumb!'});

        return res.sendFile(thumb_filepath);
      });
    } else if (IMAGE_FILE_TYPES.indexOf(fileext) != -1) {
      photoFile.generateThumbImage(filepath, thumb_filepath, {
        thumb_width: 60,
        thumb_height: 60
      }, function(err) {
        if (err) return res.status(500).send({error: 'Generate thumb failed! ' + err.message});

        return res.sendFile(thumb_filepath);
      });
    } else {
      return res.status(404).send();
    }
  });

  var getCachedImagePath = function(image_src, prefix) {
    var url_obj = urlutil.parse(image_src);
    var url_hostname = (url_obj) ? url_obj.hostname : '';
    var cached_image_path = '';
    if (!url_hostname || url_hostname == '') {
      cached_image_path = path.join(prefix || 'images', 'nohost', url_obj.pathname);
    } else {
      cached_image_path = path.join(prefix || 'images', url_hostname, url_obj.pathname);
    }
    return cached_image_path;
  }

  var cacheImage = function (req, res, next) {
    var served = false;
    if (typeof req.query.src == 'undefined') {
      res.writeHead(400); // Bad Request
      res.end();
      return;
    }

    var image_src = req.query.src;
    if (image_src.indexOf('//') == 0) {
      image_src = 'http:' + image_src;
    }
    // console.log(image_src);
    var cached_image_path = getCachedImagePath(image_src, req.query.reader ? 'reader' : 'images');
    var cached_image_abs_path = path.join(cache_dir, cached_image_path);
    // console.log(cached_image_abs_path);

    if (utils.fileExists(cached_image_abs_path)) {
      // redirect to cached file
      served = true;
      // return res.redirect(cached_image_path);
      return res.sendFile(cached_image_abs_path);
    }

    downloader.downloadFile(image_src, cached_image_abs_path, {no_rename: true}, function(err, result) {
      if (err) {
        res.writeHead(404);
        res.end();
      } else {
        // res.redirect(cached_image_path);
        return res.sendFile(cached_image_abs_path);
      }
    });
  }

  // GET /image?src=...
  // GET /image?src=...&reader=1
  app.get('/image', cacheImage);
  app.get('/images/:name', cacheImage);

  var startListen = function() {
    app.listen(listen_port, function () {
      console.log('Listening on http://localhost:'+listen_port);
      if (!options.no_open) open('http://localhost:'+listen_port);
    }).on('error', function(err) {
    if (err.code == 'EADDRINUSE') {
        setTimeout(function() {
          listen_port = listen_port + 1;
          startListen();
        });
      } else {
        console.log(err);
      }
    });
  }

  startListen();
}

var addDirToMap = function(dir) {
  var dir_path = dir.path;
  var dir_relpath = getRelPath(dir.path);

  // console.log(dir_relpath);

  if (!dirs_map[dir_relpath]) {
    dirs_map[dir_relpath] = {};
    dirs_map[dir_relpath].name = path.basename(dir_relpath);
    dirs_map[dir_relpath].path = dir_relpath;
    dirs_map[dir_relpath].size = 0;
    dirs_map[dir_relpath].files = [];
    dirs_map[dir_relpath].subdirs = [];
  }
  if (dir.atime) dirs_map[dir_relpath].atime = dir.atime;
  if (dir.mtime) dirs_map[dir_relpath].mtime = dir.mtime;
  if (dir.ctime) dirs_map[dir_relpath].ctime = dir.ctime;

  if (dir_path != 'ROOT' && !isRootPath(dir_path)) {
    var parent_dir_entry = addDirToMap({ path: path.dirname(dir_path) });
    if (parent_dir_entry.subdirs.indexOf(dir_relpath) == -1) {
      parent_dir_entry.subdirs.push(dir_relpath);
    }
  } else if (dir_path != 'ROOT' && abs_path_mode) { // isRootPath(dir_path)
    var parent_dir_entry = addDirToMap({ path: 'ROOT' });
    if (parent_dir_entry.subdirs.indexOf(dir_relpath) == -1) {
      parent_dir_entry.subdirs.push(dir_relpath);
    }
  }

  return dirs_map[dir_relpath];
}

var getDirSize = function(dir_relpath, dir_size_map) {
  // console.log('getDirSize:', dir_relpath);

  dir_size_map = dir_size_map || {};
  
  if (!dir_relpath) return 0;
  if (!dirs_map[dir_relpath]) return 0;
  if (dir_size_map[dir_relpath]) return dir_size_map[dir_relpath];

  if (dirs_map[dir_relpath].subdirs.length == 0) {
    dir_size_map[dir_relpath] = dirs_map[dir_relpath].size;
    return dirs_map[dir_relpath].size;
  }

  var dir_size = dirs_map[dir_relpath].size; // size of files (if any)
  dirs_map[dir_relpath].subdirs.forEach(function(subdir_relpath) {
    dir_size += getDirSize(subdir_relpath, dir_size_map);
  });

  dir_size_map[dir_relpath] = dir_size;
  return dir_size;
}

var createDirsIndex = function(dirs) {
  console.log('Dirs:', dirs.length);

  dirs.forEach(function(dir) {
    addDirToMap(dir);
  });
}

var recalculateDirsSize = function() {
  // calculate directory size
  for(var dir_relpath in dirs_map) {
    dirs_map[dir_relpath].size = getDirSize(dir_relpath);
  }
}

var createFilesIndex = function(files) {

  console.log('Files:', files.length);

  var total_files_size = 0;
  files.forEach(function(file) { 
    total_files_size += file.size;
  });
  console.log('Total Size:', bytes(total_files_size));

  files.forEach(function(file) {

    file.relpath = getRelPath(file.path);
    file.type = (file.type) ? file.type.toLowerCase() : '';

    files_map[file.relpath] = file;

    if (IMAGE_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_image = true;
      image_files.push(file.relpath);
    } else if (VIDEO_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_video = true;
      video_files.push(file.relpath);
    } else if (COMIC_FILE_TYPES.indexOf(file.type) != -1) {
      file.is_comic = true;
    }
    all_files.push(file.relpath);

    if (file.type && file.type != '') {
      if (!file_types_map[file.type]) {
        file_types_map[file.type] = {};
        file_types_map[file.type].count = 0;
        file_types_map[file.type].files = [];
      }
      file_types_map[file.type].count++;
      file_types_map[file.type].files.push(file.relpath);
    }
    
    var parent_dir_entry = addDirToMap({ path: path.dirname(file.path) });
    if (parent_dir_entry.files.indexOf(file.relpath) == -1) {
      parent_dir_entry.size += file.size;
      parent_dir_entry.files.push(file.relpath);
    }

    // console.log('File:', file.relpath);
    // console.log('Dir:', dir_relpath);
  });

  // get popular file types
  var file_types = [];
  for(var file_type in file_types_map) {
    file_types.push({type: file_type, count: file_types_map[file_type].count});
  }
  file_types.sort(function(a,b) {
    if (a.count>b.count) return -1;
    if (a.count<b.count) return 1;
    return 0;
  });
  if (file_types.length > 10) popular_file_types = file_types.slice(0, 10);
  else popular_file_types = file_types.slice(0);
}

var addToMangaIndex = function(index_id, key) {
  if (!manga_indices[index_id]) {
    manga_indices[index_id] = {
      map: {},
      count: 0,
      popular: []
    }
  }
  if (manga_indices[index_id].map[key]) {
    manga_indices[index_id].map[key]++;
  } else {
    manga_indices[index_id].count++;
    manga_indices[index_id].map[key] = 1;
  }
}

var getMangaIndex = function(index_id) {
  return manga_indices[index_id];
}

var generateIndexPopularList = function() {
  for (var index_id in manga_indices) {
    if (manga_indices[index_id] && manga_indices[index_id].map) {
      var key_list = [];
      for (var key in manga_indices[index_id].map) {
        key_list.push({name: key, count: manga_indices[index_id].map[key]});
      }
      console.log('Index:', index_id, key_list.length);
      sortItems(key_list, 'count', 'desc');
      manga_indices[index_id].popular = key_list.slice(0, Math.min(50, key_list.length));
    }
  }
}

var loadMangaInfo = function(manga_info_file, hyphen_fields) {
  var manga_info = utils.loadFromJsonFile(manga_info_file);

  for (var field in manga_info) {
    if (Array.isArray(manga_info[field])) {
      var items = [];
      manga_info[field].forEach(function(item) {
        if (item.name) items.push(item.name.trim());
        else if (typeof item == 'string') items.push(item.trim());
      });
      manga_info[field] = items;
    } else if (manga_info[field] && typeof manga_info[field] == 'object' && manga_info[field].name) {
      manga_info[field] = manga_info[field].name.trim();
    }
  }

  // refine values
  hyphen_fields.forEach(function(field) {
    if (manga_info[field] && Array.isArray(manga_info[field])) {
      manga_info[field] = manga_info[field].map(function(val) {
        return utils.replaceAll(val, ' ', '-').toLowerCase();
      });
    } else if (manga_info[field] && typeof manga_info[field] == 'string') {
      manga_info[field] = utils.replaceAll(manga_info[field], ' ', '-').toLowerCase();
    }
  });

  return manga_info;
}

var createMangaIndex = function(files) {
  
  var saver_files = files.filter(function(file) {
    return file.name == 'saver.json';
  });

  console.log('Loading manga:', saver_files.length);

  var mangaInfoMap = function(manga_info, field) {
    var items = [];
    manga_info[field].forEach(function(item) {
      if (item.name) items.push(item.name.trim());
      else if (typeof item == 'string') items.push(item.trim());
    });
    return items;
  }

  var hyphen_fields = [];
  var indexing_fields = [];
  manga_filters.forEach(function(manga_filter) {
    if (manga_filter.hyphen) {
      hyphen_fields.push(manga_filter.field);
    }
    if (manga_filter.index) {
      indexing_fields.push({
        field: manga_filter.field,
        index: manga_filter.index
      });
    }
  });

  saver_files.forEach(function(file, idx) {

    var saver_state = utils.loadFromJsonFile(file.path);
    
    if (saver_state['url']) {
      var manga_info = {};

      var manga_info_file = getAbsPath(path.join(path.dirname(file.relpath), 'manga.json'));
      if (utils.fileExists(manga_info_file)) {
        manga_info = loadMangaInfo(manga_info_file, hyphen_fields);
      } else {
        manga_info.url = saver_state['url'];
      }

      manga_info.relpath = path.dirname(file.relpath);

      console.log((idx+1) + '/' + saver_files.length, 'Manga:', manga_info.relpath);

      if (!manga_info.name) {
        manga_info.name = path.basename(manga_info.relpath);
      }
      if (saver_state['last_update']) {
        manga_info.last_update = new Date(saver_state['last_update']);
      }

      // console.log(manga_info);

      var missing_chapters_count = 0;
      manga_info.chapters = [];
      for (var entry in saver_state) {
        if (saver_state[entry].chapter_title && saver_state[entry].chapter_images 
          && saver_state[entry].output_dir) {
          var chapter_info = {
            url: entry,
            title: saver_state[entry].chapter_title,
            last_update: saver_state[entry].last_update,
            pages_count: saver_state[entry].chapter_images.length,
            output_dir: path.join(manga_info.relpath, saver_state[entry].output_dir),
            cbz_file: path.join(manga_info.relpath, saver_state[entry].output_dir + '.cbz')
          };

          if (utils.fileExists(getAbsPath(chapter_info.cbz_file))) {
            chapter_info.type = 'cbz';
            chapter_info.cbz_exists = true;

            manga_chapters_map[utils.md5Hash(chapter_info.cbz_file)] = {
              url: chapter_info.url,
              title: chapter_info.title,
              pages_count: saver_state[entry].chapter_images.length
            }
          } else if (utils.fileExists(getAbsPath(chapter_info.output_dir))) {
            chapter_info.type = 'folder';
            chapter_info.folder_exists = true;

            manga_chapters_map[utils.md5Hash(chapter_info.output_dir)] = {
              url: chapter_info.url,
              title: chapter_info.title,
              pages_count: saver_state[entry].chapter_images.length,
              pages: saver_state[entry].chapter_images.slice()
            }
          } else {
            missing_chapters_count++;
            chapter_info.type = 'remote';

            manga_chapters_map[utils.md5Hash(chapter_info.output_dir)] = {
              url: chapter_info.url,
              title: chapter_info.title,
              pages_count: saver_state[entry].chapter_images.length,
              pages: saver_state[entry].chapter_images.slice()
            }
          }

          if (files_map[chapter_info.cbz_file]) {
            chapter_info.cbz_size = files_map[chapter_info.cbz_file].size;
            chapter_info.cbz_mtime = files_map[chapter_info.cbz_file].mtime;
          }

          manga_info.chapters.push(chapter_info);
        }
      }

      manga_info.chapters_count = manga_info.chapters.length;
      manga_info.chapters_missing = missing_chapters_count;

      if (manga_info.chapters_count > 0) {

        if (manga_info.chapters.length) {
          sortItems(manga_info.chapters, 'title', 'desc');
        }

        manga_map[manga_info.relpath] = manga_info;
        manga_list.push(manga_info.relpath);
        manga_search_list.push({
          name: manga_info.name,
          relpath: manga_info.relpath
        });

        var first_letter = manga_info.name.charAt(0).toUpperCase();
        if (first_letter.match(/[A-Z]/)) {
          manga_info.first_letter = first_letter;
          manga_starts_with_map[first_letter] = manga_starts_with_map[first_letter] || 0;
          manga_starts_with_map[first_letter]++;
        } else {
          manga_info.first_letter = '~';
          manga_starts_with_map['~'] = manga_starts_with_map['~'] || 0;
          manga_starts_with_map['~']++;
        }

        indexing_fields.forEach(function(index_field) {
          if (typeof manga_info[index_field.field] == 'string') {
            addToMangaIndex(index_field.index, manga_info[index_field.field]);
          } else if (Array.isArray(manga_info[index_field.field])) {
            manga_info[index_field.field].forEach(function(item) {
              addToMangaIndex(index_field.index, item);
            });
          }
        });
      }
    }

    saver_state = {};
  });

  manga_starts_with_list = [];
  for (var first_letter in manga_starts_with_map) {
    manga_starts_with_list.push({name: first_letter, count: manga_starts_with_map[first_letter]});
  }
  sortItems(manga_starts_with_list, 'name', 'asc');

  generateIndexPopularList();

  console.log('Manga loaded:', manga_list.length);
}

var loadIndex = function(callback) {

  // var supported_file_types = ['mp4','mkv','avi','wmv','png','gif','jpg','jpeg','txt'];

  if (options.index_file) {
    if (!utils.fileExists(options.index_file)) {
      console.log('File not found:', options.index_file);
      return callback(new Error('File not found: ' + options.index_file));
    }

    var tmp_files_map = utils.loadFromJsonFile(options.index_file);
    var tmp_dirs_map = {};
    var dirs = [];
    var files = [];

    for (var file_relpath in tmp_files_map) {
      // console.log('File:', file_relpath);

      var file_info = tmp_files_map[file_relpath];

      file_info.path = getAbsPath(file_relpath);

      file_info.name = file_info.filename || file_info.name || path.basename(file_relpath);
      file_info.size = file_info.filesize || file_info.size || 0;
      file_info.type = file_info.filetype || file_info.type || '';

      files.push(file_info);

      var dir_path = path.dirname(file_info.path);
      if (!tmp_dirs_map[dir_path]) {
        // console.log('Dir:', dir_path);
        tmp_dirs_map[dir_path] = {
          path: dir_path
        }
        dirs.push(tmp_dirs_map[dir_path]);
      }
    }

    // files = files.filter(function(file) { 
    //   return supported_file_types.indexOf(file.type) != -1;
    // });

    createDirsIndex(dirs);
    createFilesIndex(files);
    recalculateDirsSize();

    createMangaIndex(files);

    return callback();
  } 
  else if (data_dirs.length > 1) {
    var scan_opts = {recursive: true};
    // scan_opts.file_types = supported_file_types;

    console.log('Scanning input dirs...');

    var dirs = [];
    var files = [];

    async.eachSeries(data_dirs, function(input_dir, cb) {
      console.log('Scan: ' + input_dir);
      scanDir(input_dir, scan_opts, function(err, _files, _dirs) {
        if (err) {
          console.log('Scan dir error!', input_dir);
          return cb(err);
        }

        // console.log('Dirs: ' + _dirs.length + ', Files: ' + _files.length);

        dirs = dirs.concat(_dirs);
        files = files.concat(_files);

        cb();
      });
    }, function(err) {
      if (err) {
        console.log(err);
        return callback(err);
      }

      createDirsIndex(dirs);
      createFilesIndex(files);
      recalculateDirsSize();

      createMangaIndex(files);

      return callback();
    });
  }
  else {
    var scan_opts = {recursive: true};
    // scan_opts.file_types = supported_file_types;

    console.log('Scanning input dir...');
    scanDir(data_dir, scan_opts, function(err, files, dirs) {
      if (err) {
        console.log('Scan dir error!', data_dir);
        console.log(err);
        return callback(err);
      }
      
      // files = files.filter(function(file) { 
      //   return supported_file_types.indexOf(file.type) != -1;
      // });

      createDirsIndex(dirs);
      createFilesIndex(files);
      recalculateDirsSize();

      createMangaIndex(files);

      return callback();
    });
  }
}

var reloadIndex = function(callback) {
  all_dirs = [];

  dirs_map = {};
  files_map = {};

  file_types_map = {};
  popular_file_types = [];

  image_files = [];
  video_files = [];
  all_files = [];

  manga_list = [];
  manga_map = {};
  manga_chapters_map = {};

  manga_searcher = false;
  manga_search_list = [];

  manga_indices = {};
  manga_starts_with_map = {};

  manga_starts_with_list = [];

  loadIndex(callback);
}

// Load index & start server in the first time
loadIndex(function(err) {
  if (err) {
    process.exit();
  }
  startServer();
});
