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

var mangaUpdater = require('./lib/manga-updater');
var fileUtils = require('./lib/file-utils');

var package = require('./package.json');

function printUsage() {
  console.log('Usage: mangabrowser <data-dir> [<data-dir-2>...] [OPTIONS]');
  console.log('       mangabrowser -i, --index /path/to/files.json [data-dir] [OPTIONS]');
  console.log('');
  console.log('OPTIONS:');
  console.log('     --verbose                   : verbose');
  console.log('     --no-thumbs                 : do not generate thumbnails');
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
  console.log('Index file:', options.index_file);
  data_dir = argv[0] ? path.resolve(argv[0]) : path.resolve(path.dirname(options.index_file));
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

var config = {
  thumbnails: !(options.no_thumbs)
};

var all_dirs = [];

var dirs_map = {};
var files_map = {};

var IMAGE_FILE_TYPES = ['jpg','jpeg','png','gif'];
var VIDEO_FILE_TYPES = ['mp4','webm'];
var COMIC_FILE_TYPES = ['cbz','cbr','zip'];

var file_types_map = {};
var popular_file_types = [];

var all_files = [];
var image_files = [];
var video_files = [];

var manga_list = [];
var manga_map = {};
var manga_id_map = {};
var manga_chapters_map = {};

var manga_starts_with_map = {};
var manga_starts_with_list = [];

var stat_map = {};
var comic_cache = {};

var manga_list_cache = {};

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

var manga_hyphen_fields = [];
var manga_indexing_fields = [];
manga_filters.forEach(function(manga_filter) {
  if (manga_filter.hyphen) {
    manga_hyphen_fields.push(manga_filter.field);
  }
  if (manga_filter.index) {
    manga_indexing_fields.push({
      field: manga_filter.field,
      index: manga_filter.index
    });
  }
});

if (options.listen_port) {
  options.listen_port = parseInt(options.listen_port);
  if (isNaN(options.listen_port)) {
    console.log('Invalid listern port: ' + options.listen_port);
    process.exit();
  }
}

var io = null;
var index_reloading = false;

var listen_port = options.listen_port || 31128;

var mangabrowser_conf_dir = path.join(utils.getUserHome(), '.jul11co', 'mangabrowser');

var cache_dir = path.join(mangabrowser_conf_dir, 'cache');
fse.ensureDirSync(cache_dir);

var covers_dir = path.join(mangabrowser_conf_dir, 'covers');
fse.ensureDirSync(covers_dir);

var thumbs_dir = path.join(mangabrowser_conf_dir, 'thumbs');
fse.ensureDirSync(thumbs_dir);

var db_dir = path.join(mangabrowser_conf_dir, 'databases');
fse.ensureDirSync(db_dir);
fse.ensureDirSync(path.join(db_dir, utils.md5Hash(data_dir)));

var chapter_read_store = new JsonStore({file: path.join(db_dir, utils.md5Hash(data_dir), 'chapter_read.json')});

var update_manga_queue = new JobQueue();

///

var getAbsPath = function(relpath) {
  if (abs_path_mode) {
    return relpath;
  } else {
    return path.isAbsolute(relpath) ? relpath : path.join(data_dir, relpath);
  }
}

var getRelPath = function(abspath) {
  if (abs_path_mode) {
    return abspath;
  } else {
    return (abspath == data_dir || abspath == 'ROOT' || abspath == '.') ? '.' : path.relative(data_dir, abspath);
  }
}

var isRootPath = function(abspath) {
  if (abs_path_mode) {
    return abspath == '/' || abspath == 'ROOT' || abspath == '.';
  } else {
    return abspath == data_dir || abspath == '.' || abspath == '/' || abspath == 'ROOT';
  }
}

///

function isChapterRead(chapter_url) {
  return chapter_read_store.get(utils.md5Hash(chapter_url));
}

function setChapterRead(chapter_url, read_info) {
  console.log('Read chapter:', chapter_url);
  chapter_read_store.set(utils.md5Hash(chapter_url), read_info || {last_read: new Date()});
}

///

var decodeQueryPath = function(query_path) {
  var decoded_path = query_path;
  try {
    decoded_path = decodeURIComponent(query_path);
  } catch (e) {
    if (e instanceof URIError) {
      decoded_path = query_path;
    } else {
      return null;
    }
  }
  return decoded_path;
}

var getParentDirs = function(_path, debug) {
  var parents = [];
  if (isRootPath(_path)) {
    return parents;
  }
  if (debug) console.log('getParentDirs:', _path);
  var parent = path.dirname(_path);
  if (parent) {
    if (isRootPath(parent)) {
      parents.push('ROOT');
    } else {
      var _parents = getParentDirs(parent, debug);
      if (_parents.length) parents = parents.concat(_parents);
      parents.push(parent);
    }
  }
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

///

var startServer = function() {
  var express = require('express');
  var session = require('express-session');

  var app = express();

  var cookieParser = require('cookie-parser');
  var bodyParser = require('body-parser');

  // view engine setup
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.use(session({
    secret: 'jul11co-mangabrowser',
    resave: true,
    saveUninitialized: true
  }));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({extended: true}));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, 'public')))

  app.get('/info', function(req, res) {
    return res.json({
      name: 'MangaBrowser',
      version: package.version,
      data_dir: path.resolve(data_dir)
    });
  });

  // GET /files?dir=...
  // GET /files?all=1
  // GET /files?images=1
  // GET /files?videos=1
  // GET /files?file_type=...
  var fileBrowser = function(req, res) {
    var dirs = [];
    var files = [];
    var total_size = 0;

    var dir_path = req.query.dir ? decodeQueryPath(req.query.dir) : '.';
    if (abs_path_mode && dir_path == '.') dir_path = 'ROOT';

    var parents = [];
    if (req.query.from_dir) {
      req.query.from_dir = decodeQueryPath(req.query.from_dir);
      dir_path = req.query.from_dir;
    }

    // if (dir_path != '.' && dir_path != 'ROOT') {
    if (!isRootPath(dir_path)) {
      var dir_parents = getParentDirs(getAbsPath(dir_path));
      parents = dir_parents.map(function(parent_path) {
        return {path: getRelPath(parent_path), name: path.basename(parent_path)};
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
    else if (req.query.all) {
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
      // dir_file_types.sort(function(a,b) {
      //   if (a.count>b.count) return -1;
      //   if (a.count<b.count) return 1;
      //   return 0;
      // });
      sortItems(dir_file_types, 'count', 'desc');
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
    } else { // start_index >= dirs.length
      files = files.slice(start_index-dirs.length, end_index-dirs.length);
      dirs = [];
    }
    
    var exists_map = {};
    dirs.forEach(function(dir) {
      dir.missing = !fileUtils.checkDirExists(getAbsPath(dir.path), exists_map);
    });
    files.forEach(function(file) {
      file.missing = !fileUtils.checkFileExists(getAbsPath(file.relpath), exists_map);
    });

    res.render('file-browser', {
      config: config,
      query: query,
      // navigation
      parents: parents,
      // current dir info
      dir_path: dir_path,
      dir_name: path.basename(dir_path),
      dir_file_types: dir_file_types,
      total_size: total_size,
      items_length: items_length, // dirs_length + files_length
      dirs: dirs,
      dirs_length: dirs_length,
      files: files,
      files_length: files_length,
      // reference to manga in the same dir
      manga: manga_map[dir_path],
      // global
      manga_count: manga_list.length,
      files_count: all_files.length,
      images_count: image_files.length,
      videos_count: video_files.length,
      popular_file_types: popular_file_types,
      // helpers
      path: path,
      bytes: bytes,
      moment: moment,
      utils: utils
    });
  };

  var mangaInfo = function(req, res) {

    var query = Object.assign({}, req.query);

    var manga_relpath = query.manga ? decodeQueryPath(query.manga) : decodeQueryPath(query.path);
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
    // if (manga_relpath != '.' && manga_relpath != 'ROOT') {
    if (!isRootPath(manga_relpath)) {
      var manga_parents = getParentDirs(getAbsPath(manga_relpath));
      parents = manga_parents.map(function(parent_path) {
        return {path: getRelPath(parent_path), name: path.basename(parent_path)};
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
      // navigation
      scope: 'manga_info',
      parents: parents,
      manga: manga,
      // global
      files_count: all_files.length,
      manga_count: manga_list.length,
      manga_indices: manga_indices,
      manga_filters: manga_filters,
      manga_field_filter_map: manga_field_filter_map,
      manga_starts_with_list: manga_starts_with_list,
      manga_search_recent: manga_search_recent,
      // helpers
      path: path,
      bytes: bytes,
      moment: moment,
      utils: utils
    });
  }

  var mangaList = function(req, res) {
    if (req.query.view) {
      return res.render('manga-browser', {
        config: config,
        query: req.query,
        // navigation
        scope: 'manga_list',
        manga: {},
        manga_items: [],
        items_count: 0,
        // pagination
        page_size: 100,
        current_page: 1,
        page_count: 1,
        // global
        files_count: all_files.length,
        manga_count: manga_list.length,
        manga_indices: manga_indices,
        manga_filters: manga_filters,
        manga_field_filter_map: manga_field_filter_map,
        manga_starts_with_list: manga_starts_with_list,
        manga_search_recent: manga_search_recent,
        // helpers
        path: path,
        bytes: bytes,
        moment: moment,
        utils: utils
      });
    }

    var query = Object.assign({}, req.query);

    var manga_sort_field = 'name';
    var manga_sort_order = query.mangaorder || 'asc';

    if (query.mangasort == 'url') {
      // sortItems(manga_items, 'url', query.mangaorder || 'asc');
      manga_sort_field = 'url';
      manga_sort_order = query.mangaorder || 'asc';
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'asc';
      }
    } else if (query.mangasort == 'last_update') {
      // sortItems(manga_items, 'last_update', query.mangaorder || 'desc');
      manga_sort_field = 'last_update';
      manga_sort_order = query.mangaorder || 'desc';
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'desc';
      }
    } else if (query.mangasort == 'last_chapter_update') {
      // sortItems(manga_items, 'last_chapter_update', query.mangaorder || 'desc');
      manga_sort_field = 'last_chapter_update';
      manga_sort_order = query.mangaorder || 'desc';
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'desc';
      }
    } else if (query.mangasort == 'chapters_count') {
      // sortItems(manga_items, 'chapters_count', query.mangaorder || 'desc');
      manga_sort_field = 'chapters_count';
      manga_sort_order = query.mangaorder || 'desc';
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'desc';
      }
    } else if (query.mangasort) {
      // sortItems(manga_items, query.mangasort, query.mangaorder || 'desc');
      manga_sort_field = query.mangasort;
      manga_sort_order = query.mangaorder || 'desc';
      if (req.session) {
        req.session.mangasort = query.mangasort;
        req.session.mangaorder = query.mangaorder || 'desc';
      }
    } else if (query.mangasort != 'name' && req.session && req.session.mangasort) {
      // sortItems(manga_items, req.session.mangasort, query.mangaorder || req.session.mangaorder);
      manga_sort_field = req.session.mangasort;
      manga_sort_order = query.mangaorder || req.session.mangaorder;
      query.mangasort = req.session.mangasort;
      query.mangaorder = query.mangaorder || req.session.mangaorder;
    } else {
      // sortItems(manga_items, 'name', query.mangaorder || 'asc');
      if (req.session) {
        delete req.session.mangasort;
        delete req.session.mangaorder;
      }
    }

    var parents = [];
    if (query.from_dir) {
      query.from_dir = decodeQueryPath(query.from_dir);

      if (!isRootPath(query.from_dir)) {
        var parent_dirs = getParentDirs(getAbsPath(query.from_dir));
        parents = parent_dirs.map(function(parent_path) {
          return {path: getRelPath(parent_path), name: path.basename(parent_path)};
        });
      }
    }

    var manga_items = [];

    var list_cache_key = 'mangalist';
    if (query.search) {
      list_cache_key += ':search=' + utils.md5Hash(query.search);
    }
    if (query.from_dir) {
      list_cache_key += ':from_dir=' + utils.md5Hash(query.from_dir);
    }
    if (query.starts_with) {
      list_cache_key += ':starts_with=' + query.starts_with;
    }
    manga_filters.forEach(function(manga_filter) {
      if (query[manga_filter.param]) {
        list_cache_key += ':' + manga_filter.param  + '=' + utils.md5Hash(query[manga_filter.param]);
      }
    });
    list_cache_key += ':sort_field=' + manga_sort_field;
    list_cache_key += ':sort_order=' + manga_sort_order;

    // console.log('Cache key:', list_cache_key);

    if (manga_list_cache[list_cache_key]) {
      manga_items = manga_list_cache[list_cache_key];
    } else {
      if (query.search) {
        if (manga_search_recent.length > 10) {
          manga_search_recent.pop();
        }
        if (manga_search_recent.indexOf(query.search) != 0) {
          manga_search_recent.unshift(query.search);
        }

        if (!manga_searcher) {
          manga_searcher = new Fuse(manga_search_list, manga_search_opts);
        }

        // console.log('Search:', query.search);
        var matched_manga_list = manga_searcher.search(query.search);

        var unique_manga_relpaths = [];
        matched_manga_list = matched_manga_list.filter(function(matched_manga) {
          if (matched_manga.relpath && unique_manga_relpaths.indexOf(matched_manga.relpath) == -1) {
            unique_manga_relpaths.push(matched_manga.relpath);
            return true;
          }
          return false;
        });      
        // console.log('Found:', matched_manga_list.length);
        
        manga_items = matched_manga_list.map(function(matched_manga) {
          return manga_map[matched_manga.relpath];
        });
      } else {
        manga_items = manga_list.map(function(manga_relpath) {
          return manga_map[manga_relpath];
        });
      }

      if (query.from_dir && !isRootPath(query.from_dir)) {
        manga_items = manga_items.filter(function(manga_item) {
          return manga_item.relpath.indexOf(query.from_dir) == 0;
        });
      }

      if (query.starts_with) {
        var starts_with_uc = query.starts_with.toUpperCase();

        manga_items = manga_items.filter(function(manga_item) {
          return manga_item.first_letter == starts_with_uc;
        });
      }

      manga_filters.forEach(function(manga_filter) {
        if (query[manga_filter.param]) {
          var query_field = manga_filter.field;
          var query_value = query[manga_filter.param];
          var is_string_array = (manga_filter.data_type == 'string_array');

          manga_items = manga_items.filter(function(manga_item) {
            if (is_string_array && manga_item[query_field]) {
              if (query_value.split(' ').length > 1) {
                return query_value.split(' ').every(function(query_part) {
                  return manga_item[query_field].indexOf(query_part.trim()) >= 0;
                });
              }
              return manga_item[query_field] && manga_item[query_field].indexOf(query_value) >= 0;
            } else {
              return manga_item[query_field] == query_value;
            }
            return false;
          });
        }
      });

      sortItems(manga_items, manga_sort_field, manga_sort_order);

      manga_list_cache[list_cache_key] = manga_items;
    }

    if (query.listview) {
      if (req.session) req.session.listview = query.listview;
    } else if (req.session) {
      query.listview = req.session.listview;
    }

    var page_size = query.page_size ? parseInt(query.page_size) : 100;
    var page_count = Math.ceil(manga_items.length/page_size);
    var current_page = query.page ? parseInt(query.page) : 1;

    query.limit = query.limit ? parseInt(query.limit) : page_size;
    query.skip = query.skip ? parseInt(query.skip) : ((current_page-1)*page_size);
    
    if (typeof query.page == 'undefined' && query.skip) {
      current_page = Math.floor(query.skip/page_size) + 1;
    }

    var start_index = Math.min(query.skip, manga_items.length);
    var end_index = Math.min(query.skip + query.limit, manga_items.length);
    var items_count = manga_items.length;

    manga_items = manga_items.slice(start_index, end_index);

    res.render('manga-browser', {
      config: config,
      query: query,
      // navigation
      scope: 'manga_list',
      manga: {},
      parents: parents,
      manga_items: manga_items,
      items_count: items_count,
      // pagination
      page_size: page_size,
      current_page: current_page,
      page_count: page_count,
      // global
      files_count: all_files.length,
      manga_count: manga_list.length,
      manga_indices: manga_indices,
      manga_filters: manga_filters,
      manga_field_filter_map: manga_field_filter_map,
      manga_starts_with_list: manga_starts_with_list,
      manga_search_recent: manga_search_recent,
      // helpers
      path: path,
      bytes: bytes,
      moment: moment,
      utils: utils
    });
  }

  // GET /
  app.get('/', function(req, res) {
    if (req.query.dir || req.query.all || req.query.images || req.query.videos || req.query.file_type) {
      return fileBrowser(req, res);
    } else if (req.query.manga && req.query.manga != '.') {
      return mangaInfo(req, res);
    } else {
      return mangaList(req, res);
    }
  });

  // GET /files?dir=...
  // GET /files?files=1
  // GET /files?images=1
  // GET /files?videos=1
  // GET /files?file_type=1
  app.get('/files', function(req, res) {
    return fileBrowser(req, res);
  });

  // GET /manga?path=...
  app.get('/manga', function(req, res) {
    return mangaInfo(req, res);
  });

  // GET /mangalist?from_dir=...
  // GET /mangalist?<FILTER>=...
  // GET /mangalist?view=...
  app.get('/mangalist', function(req, res) {
    return mangaList(req, res);
  });

  app.get('/reload_index', function(req, res) {
    reloadIndex(function(err) {
      if (err) return res.status(500).send({error: err.message});
      res.redirect('/');
    });
  });

  // GET /open?path=...
  app.get('/open', function(req, res) {
    var fpath = getAbsPath(decodeQueryPath(req.query.path));
    open(fpath);
    return res.json({ok: 1});
  });

  // POST /delete/path=...
  app.post('/delete', function(req, res) {
    var frelpath = decodeQueryPath(req.query.path);
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
    var filepath = getAbsPath(decodeQueryPath(req.query.path));
    return res.sendFile(filepath);
  }

  // GET /file?path=...
  app.get('/file', getFile);
  app.get('/files/:filename', getFile);

  // GET /video?path=...
  app.get('/video', function(req, res) {
    var filepath = getAbsPath(decodeQueryPath(req.query.path));
    if (!file_stat_map[filepath]) {
      file_stat_map[filepath] = fs.statSync(filepath);
    }
    var stat = file_stat_map[filepath];
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

  // GET /comic?path=...
  // GET /comic?path=...&info=true
  // GET /comic?path=...&page=NUM
  app.get('/comic', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    
    var filepath = getAbsPath(decodeQueryPath(req.query.path));
    var filepath_hash = utils.md5Hash(filepath);
    
    if (req.query.page) {
      var page_num = parseInt(req.query.page);
      if (isNaN(page_num)) return res.status(400).send({error: 'Invalid page number'});

      var extractPage = function(page_file_name) {
        var target_dir = path.join(cache_dir, 'contents', filepath_hash[0], 
            filepath_hash[1]+filepath_hash[2], filepath_hash);

        if (utils.fileExists(path.join(target_dir, page_file_name))) {
          return res.sendFile(path.join(target_dir, page_file_name));
        }
        
        comicFile.extractPage(filepath, page_file_name, {
          targetDir: target_dir
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
      var chapterpath = path.join(path.dirname(filepath), path.basename(filepath, path.extname(filepath)));
      var chapterpath_hash = utils.md5Hash(chapterpath);

      var chapter_info = manga_chapters_map[chapterpath_hash];
      if (chapter_info && chapter_info.url) {
        setChapterRead(chapter_info.url);
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
    
    var chapterpath = decodeQueryPath(req.query.path);
    var chapterpath_abs = getAbsPath(chapterpath);

    // console.log('Chapter: ' + chapterpath);
    var chapterpath_hash = utils.md5Hash(chapterpath);
    var chapter_info = manga_chapters_map[chapterpath_hash];

    if (req.query.page) {
      var page_num = parseInt(req.query.page);
      if (isNaN(page_num)) return res.status(400).send({error: 'Invalid page number'});

      if (chapter_info && chapter_info['pages'] && chapter_info['pages'].length > page_num) {
        var page_file = chapter_info['pages'][page_num].file;

        if (page_file && utils.fileExists(path.join(chapterpath_abs, page_file))) {
          return res.sendFile(path.join(chapterpath_abs, page_file));
        }
        
        var page_src = chapter_info['pages'][page_num].src;
        return res.redirect('/image?src=' + encodeURIComponent(page_src) + '&reader=1');
      } else {
        return res.status(404).send('Missing page: ' + page_num);
      }
    } else {
      if (!chapter_info) {
        return res.status(404).send('Chapter not found: ' + chapterpath);
      }

      if (chapter_info.url) {
        setChapterRead(chapter_info.url)
      }

      return res.json(chapter_info);
    }
  });

  var fetchAndCacheMangaCover = function(manga, opts, callback) {
    if (typeof opts == 'function') {
      callback = opts;
      opts = {};
    }
    if (!manga || !manga.cover_image) return res.status(404).send('No manga cover');

    var cover_hash = utils.md5Hash(manga.cover_image);
    var cover_filepath = path.join(covers_dir, cover_hash[0], 
      cover_hash[1]+cover_hash[2], cover_hash);

    fse.ensureDirSync(path.dirname(cover_filepath));

    if (!opts.refresh && utils.fileExists(cover_filepath)) {
      return callback(null, cover_filepath);
    }

    fetchAndCacheImage(manga.cover_image, {
      request_headers: opts.request_headers || {
        "Referer": manga.url,
        "User-Agent": "Mozilla/5.0"
      }
    }, function(err, cached_filepath) {
      if (err) {
        if (err.httpStatusCode == 403) {
          var retry_opts = Object.assign({}, opts);
          retry_opts.request_headers = {};
          return fetchAndCacheMangaCover(manga, retry_opts, callback);
        }
        return callback(err);
      }

      fse.copySync(cached_filepath, cover_filepath, { overwrite: true, preserveTimestamps: true });

      callback(null, cover_filepath);
    });
  }

  // GET /manga_cover?path=...
  // GET /manga_cover?id=...
  app.get('/manga_cover', function(req, res, next) {
    if (!req.query.path && !req.query.id) return res.status(400).send('Missing manga path or id');
    
    var manga_path = null;
    if (req.query.path) {
      manga_path = decodeQueryPath(req.query.path);
    } else if (req.query.id) {
      manga_path = manga_id_map[req.query.id];
      if (!manga_path) return res.status(404).send('Manga ID not found');
    }
    
    var manga_relpath = getRelPath(manga_path);
    var manga = manga_map[manga_relpath];

    if (!manga || !manga.cover_image) return res.status(404).send('No manga cover');

    fetchAndCacheMangaCover(manga, {refresh: req.query.refresh}, function(err, cover_filepath) {
      if (err) {
        return res.status(500).send('Get manga cover failed! ' + err.message);
      }

      if (req.query.size == 'thumb') {
        var filepath_hash = utils.md5Hash(cover_filepath);
    
        var thumb_filepath = path.join(thumbs_dir, filepath_hash[0], 
          filepath_hash[1]+filepath_hash[2], filepath_hash);

        fse.ensureDirSync(path.dirname(thumb_filepath));

        if (!req.query.refresh && utils.fileExists(thumb_filepath)) {
          return res.sendFile(thumb_filepath);
        }

        photoFile.generateThumbImage(cover_filepath, thumb_filepath, {
          thumb_width: 160,
          thumb_height: 250
        }, function(err) {
          if (err) {
            console.error('Generate thumb failed! ' + err.message, cover_filepath);
            return res.sendFile(cover_filepath);
          }

          return res.sendFile(thumb_filepath);
        });
      } else {
        return res.sendFile(cover_filepath);
      }
    }); // fetchAndCacheMangaCover
  });

  // POST /disable_manga_update?path=...
  app.post('/disable_manga_update', function(req, res) {
    if (!req.query.path) return res.status(400).json({error: 'Missing manga path'});
    var manga_path = getAbsPath(decodeQueryPath(req.query.path));

    var saver_file = path.join(manga_path, 'saver.json');
    if (!utils.fileExists(saver_file)) {
      return res.status(500).json({error: 'Cannot disable manga update'});
    }

    var saver_state = utils.loadFromJsonFile(saver_file);
    saver_state['ignore'] = true;

    utils.saveToJsonFile(saver_state, saver_file);
 
    var manga_relpath = getRelPath(manga_path);
    if (manga_map[manga_relpath]) {
      manga_map[manga_relpath]['update_enable'] = false;
    }

    res.json({success: true});
  });

  // POST /enable_manga_update?path=...
  app.post('/enable_manga_update', function(req, res) {
    if (!req.query.path) return res.status(400).json({error: 'Missing manga path'});
    var manga_path = getAbsPath(decodeQueryPath(req.query.path));
    
    var saver_file = path.join(manga_path, 'saver.json');
    if (!utils.fileExists(saver_file)) {
      return res.status(500).json({error: 'Cannot disable manga update'});
    }

    var saver_state = utils.loadFromJsonFile(saver_file);
    saver_state['ignore'] = false;

    utils.saveToJsonFile(saver_state, saver_file);
 
    var manga_relpath = getRelPath(manga_path);
    if (manga_map[manga_relpath]) {
      manga_map[manga_relpath]['update_enable'] = true;
    }

    res.json({success: true});
  });

  // GET /thumb?path=...
  app.get('/thumb', function(req, res) {
    if (!req.query.path) return res.status(400).send({error: 'Missing file path'});
    
    var filepath = getAbsPath(decodeQueryPath(req.query.path));
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

  var fetchAndCacheImage = function(image_src, opts, done) {
    if (typeof opts == 'function') {
      done = opts;
      opts = {};
    }

    var cached_image_path = getCachedImagePath(image_src, opts.reader ? 'reader' : 'images');
    var cached_image_abs_path = path.join(cache_dir, cached_image_path);

    if (utils.fileExists(cached_image_abs_path)) {
      return done(null, cached_image_abs_path);
    }

    var download_opts = {
      no_rename: true
    };

    if (opts.request_headers) {
      download_opts.request_headers = opts.request_headers;
    }

    if (image_src.indexOf('//') == 0) {
      image_src = 'http:' + image_src;
    }

    downloader.downloadFile(image_src, cached_image_abs_path, download_opts, function(err, result) {
      if (err) {
        console.error('Request image failed!', image_src, err.httpStatusCode, err.message);
        var error = new Error('Request image failed! ' + err.message);
        error.httpStatusCode = err.httpStatusCode;
        return done(error);
      } else {
        return done(null, cached_image_abs_path);
      }
    });
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

    fetchAndCacheImage(image_src, {reader: req.query.reader}, function(err, cached_image_abs_path) {
      if (err) {
        console.error(err.message);
        res.writeHead(404);
        res.end();
      } else {
        return res.sendFile(cached_image_abs_path);
      }
    });
  }

  // GET /image?src=...
  // GET /image?src=...&reader=1
  app.get('/image', cacheImage);
  app.get('/images/:name', cacheImage);

  // Viewer

  // GET /viewer?path=...
  app.get('/viewer', function(req, res) {
    return res.render('manga-viewer.ejs', {
      error: null,
      manga: { path: req.query.path },
      view_settings: req.cookies,
      // helpers
      path: path,
      bytes: bytes,
      moment: moment,
      utils: utils
    });
  });

  // GET /viewer_json?path=...
  app.get('/viewer_json', function(req, res, next) {
    var datapath = decodeQueryPath(req.query.path);

    // console.log('Viewer JSON:', datapath);

    var manga = manga_map[datapath];

    if (manga) { // manga info
      return res.json({
        page: {
          url: datapath,
          manga: {
            url: manga.relpath || datapath,
            name: manga.name,
            chapters: manga.chapters.map(function(chapter_info) {
              return {
                url: chapter_info.output_dir, // reference to chapter in manga_chapters_map
                title: chapter_info.title,
                pages_count: chapter_info.pages_count
              }
            })
          }
        }
      });
    } else {
      var chapter_path = datapath;
      var chapter_path_hash = utils.md5Hash(chapter_path);

      var manga_path = path.dirname(datapath);
      var manga = manga_map[manga_path];

      // console.log('Manga:', manga_path);

      var chapter_info = manga_chapters_map[chapter_path_hash];
      if (chapter_info) { // manga chapters
        var chapter_images = [];

        // console.log('Chapter:', datapath);

        if (chapter_info.cbz_file && utils.fileExists(chapter_info.cbz_file)) {
          // console.log('Chapter CBZ:', chapter_info.cbz_file);

          if (comic_cache[chapter_path_hash]) {
            chapter_images = comic_cache[chapter_path_hash].pages.map(function(chapter_page, idx) {
              return {
                src: '/comic?path=' + encodeURIComponent(chapter_info.cbz_file) + '&page=' + idx 
              }
            });

            return res.json({
              page: {
                url: datapath,
                manga: {
                  url: manga ? manga.relpath : manga_path,
                  title: manga ? manga.name : path.basename(manga_path),
                  chapter_url: chapter_path,
                  chapter_title: chapter_info.title,
                  images: chapter_images
                }
              }
            });
          }

          comicFile.getInfo(chapter_info.cbz_file, function(err, result) {
            if (err) return res.status(500).send({error: 'Get file info failed! ' + err.message});
            if (!result) return res.status(500).send({error: 'Cannot get file info!'});
            
            // console.log(result);

            comic_cache[chapter_path_hash] = result;

            chapter_images = result.pages.map(function(chapter_page, idx) {
              return {
                src: '/comic?path=' + encodeURIComponent(chapter_info.cbz_file) + '&page=' + idx 
              }
            });

            if (chapter_info.url) {
              setChapterRead(chapter_info.url);
            }

            return res.json({
              page: {
                url: datapath,
                manga: {
                  url: manga ? manga.relpath : manga_path,
                  title: manga ? manga.name : path.basename(manga_path),
                  chapter_url: chapter_path,
                  chapter_title: chapter_info.title,
                  images: chapter_images
                }
              }
            });
          });
        } else {
          chapter_images = chapter_info.pages.map(function(chapter_page, idx) {
            return {
              src: '/manga_chapter?path=' + encodeURIComponent(datapath) + '&page=' + idx 
            }
          });

          if (chapter_info.url) {
            setChapterRead(chapter_info.url);
          }

          return res.json({
            page: {
              url: datapath,
              manga: {
                url: manga ? manga.relpath : manga_path,
                title: manga ? manga.name : path.basename(manga_path),
                chapter_url: chapter_path,
                chapter_title: chapter_info.title,
                images: chapter_images
              }
            }
          });
        }
      } else {
        console.log('No chapter:', chapter_path);
        return res.status(404).json({});
      }
    }
  });

  ///

  var startIoServer = function(server) {
    io = require('socket.io')(server);
    io.on('connection', function(socket) {
      socket.on('reload-index', function(data) {
        console.log('Reload index requested!');
        reloadIndex(function(err) {
          if (err) {
            console.log(err.message);
          } else {
            console.log('Index reloaded');
          }
        });
      });

      socket.on('update-manga', function(data) {
        if (data && data.path) {
          console.log('Update manga requested!', data.path);

          update_manga_queue.pushJob({
            manga_path: data.path
          }, function(args, done) {
            var manga = manga_map[args.manga_path];
            if (!manga) {
              return done(new Error('Non-existing manga'));
            }
              
            io.emit('update-manga-start', { path: args.manga_path });

            updateManga(manga, { ignore_last_update: true }, done);
          }, function(err) {
            if (err) {
              console.error(err);

              io.emit('update-manga-result', {
                path: data.path,
                error: err.message
              });
            } else {
              io.emit('update-manga-result', {
                path: data.path,
                success: true
              });
            }
          });

          io.emit('update-manga-queued', { path: data.path });
        }
      });
    });
  }

  var startListen = function(done) {
    var server = app.listen(listen_port, function () {
      done(null, server);
    }).on('error', function(err) {
      if (err.code == 'EADDRINUSE') {
        setTimeout(function() {
          listen_port = listen_port + 1;
          startListen(done);
        });
      } else {
        done(err);
      }
    });
  }

  startListen(function(err, server) {
    if (!err) {
      console.log('Listening on http://localhost:'+listen_port);
      if (!options.no_open) open('http://localhost:'+listen_port);
      startIoServer(server);
    } else {
      console.log(err);
    }
  });
}

///

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

  if (/*dir_path != 'ROOT' && */!isRootPath(dir_path)) {
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

  // var dir_size = dirs_map[dir_relpath].size; // size of files (if any)
  var dir_size = 0;
  dirs_map[dir_relpath].files.forEach(function(file_relpath) {
    dir_size += files_map[file_relpath].size;
  });
  dirs_map[dir_relpath].subdirs.forEach(function(subdir_relpath) {
    dir_size += getDirSize(subdir_relpath, dir_size_map);
  });

  dir_size_map[dir_relpath] = dir_size;
  return dir_size;
}

var updateParentDirSize = function(frelpath) {
  var parent_dirs = getParentDirs(getAbsPath(frelpath));
  if (parent_dirs && parent_dirs.length) {
    // console.log(parent_dirs);
    var dir_size_map = {};
    parent_dirs.forEach(function(parent_dir) {
      if (dirs_map[parent_dir]) {
        dirs_map[parent_dir].size = getDirSize(parent_dir, dir_size_map);
      }
    });
  }
}

var recalculateDirsSize = function() {
  // calculate directory size
  for(var dir_relpath in dirs_map) {
    dirs_map[dir_relpath].size = getDirSize(dir_relpath);
  }
}

var createDirsIndex = function(dirs) {
  console.log('Dirs:', dirs.length);

  dirs.forEach(function(dir) {
    addDirToMap(dir);
  });
}

var addFileToMap = function(file) {

  file.relpath = getRelPath(file.path);
  file.type = (file.type) ? file.type.toLowerCase() : '';

  files_map[file.relpath] = file;
  all_files.push(file.relpath);

  if (IMAGE_FILE_TYPES.indexOf(file.type) != -1) {
    file.is_image = true;
    image_files.push(file.relpath);
  } else if (VIDEO_FILE_TYPES.indexOf(file.type) != -1) {
    file.is_video = true;
    video_files.push(file.relpath);
  } else if (COMIC_FILE_TYPES.indexOf(file.type) != -1) {
    file.is_comic = true;
  }

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
}

var createFilesIndex = function(files) {

  console.log('Files:', files.length);

  var total_files_size = 0;
  files.forEach(function(file) { 
    total_files_size += file.size;
  });
  console.log('Total Size:', bytes(total_files_size));

  files.forEach(function(file) {
    addFileToMap(file);
  });

  // get popular file types
  var file_types = [];
  for(var file_type in file_types_map) {
    file_types.push({type: file_type, count: file_types_map[file_type].count});
  }
  // file_types.sort(function(a,b) {
  //   if (a.count>b.count) return -1;
  //   if (a.count<b.count) return 1;
  //   return 0;
  // });
  sortItems(file_types, 'count', 'desc');
  if (file_types.length > 10) popular_file_types = file_types.slice(0, 10);
  else popular_file_types = file_types.slice(0);
}

///

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

var loadMangaInfoFromFile = function(manga_info_file) {
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
  manga_hyphen_fields.forEach(function(field) {
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

var loadMangaInfo = function(manga_dir, saver_file_name) {
  var manga_info = {};

  var manga_info_file = getAbsPath(path.join(manga_dir, 'manga.json'));
  if (utils.fileExists(manga_info_file)) {
    manga_info = loadMangaInfoFromFile(manga_info_file);
  }

  manga_info.path = manga_dir;
  manga_info.relpath = getRelPath(manga_dir);

  if (!manga_info.name) {
    manga_info.name = path.basename(manga_info.relpath);
  }

  saver_file_name = saver_file_name || 'saver.json';
  var saver_file = getAbsPath(path.join(manga_dir, saver_file_name));
  if (!utils.fileExists(saver_file)) {
    return;
  }

  var saver_state = utils.loadFromJsonFile(saver_file);

  if (!manga_info.url && saver_state['url']) {
    manga_info.url = saver_state['url'];
  }

  if (saver_state['ignore']) {
    manga_info.update_enable = false;
  } else {
    manga_info.update_enable = true;
  }

  if (saver_state['last_update']) {
    manga_info.last_update = new Date(saver_state['last_update']);
  }

  // console.log(manga_info);
  manga_info.last_chapter_update = 0;

  var missing_chapters_count = 0;
  manga_info.chapters = [];

  for (var entry_url in saver_state) {
    var entry_info = saver_state[entry_url];
    if (entry_info.chapter_title && entry_info.chapter_images && entry_info.output_dir) {
      var chapter_info = {
        url: entry_url,
        title: entry_info.chapter_title,
        last_update: new Date(entry_info.last_update),
        pages_count: entry_info.chapter_images.length,
        output_dir: path.join(manga_info.relpath, entry_info.output_dir),
        cbz_file: path.join(manga_info.relpath, entry_info.output_dir + '.cbz')
      };

      if (chapter_info.last_update && chapter_info.last_update > manga_info.last_chapter_update) {
        manga_info.last_chapter_update = chapter_info.last_update;
      }

      chapter_info.title_lc = chapter_info.title.toLowerCase();

      if (utils.fileExists(getAbsPath(chapter_info.cbz_file))) {
        chapter_info.type = 'cbz';
        chapter_info.cbz_exists = true;

        chapter_info.pages_count = entry_info.chapter_images.length;
        chapter_info.pages = entry_info.chapter_images.slice();

        if (files_map[chapter_info.cbz_file]) {
          chapter_info.cbz_size = files_map[chapter_info.cbz_file].size;
          chapter_info.cbz_mtime = files_map[chapter_info.cbz_file].mtime;
        } else {
          var cbz_file_stats = fileUtils.getFileStatsSync(getAbsPath(chapter_info.cbz_file));
          chapter_info.cbz_size = cbz_file_stats['size'];
          chapter_info.cbz_mtime = cbz_file_stats['mtime'];

          addFileToMap({
            path: getAbsPath(chapter_info.cbz_file),
            name: path.basename(chapter_info.cbz_file),
            type: 'cbz',
            size: cbz_file_stats['size'],
            atime: cbz_file_stats['atime'],
            mtime: cbz_file_stats['mtime'],
            ctime: cbz_file_stats['ctime']
          });
        }

      } else {
        missing_chapters_count++;
        chapter_info.type = 'remote';

        chapter_info.pages_count = entry_info.chapter_images.length;
        chapter_info.pages = entry_info.chapter_images.slice();
      }

      var chapter_hash = utils.md5Hash(chapter_info.output_dir);

      manga_chapters_map[chapter_hash] = {
        output_dir: chapter_info.output_dir,
        url: chapter_info.url,
        title: chapter_info.title,
        title_lc: chapter_info.title_lc,
        pages_count: chapter_info.pages_count,
        pages: chapter_info.pages,
        cbz_file: getAbsPath(chapter_info.cbz_file)
      }

      manga_info.chapters.push(chapter_info);
    }
  }

  manga_info.chapters_count = manga_info.chapters.length;
  manga_info.chapters_missing = missing_chapters_count;

  return manga_info;
}

var addManga = function(saver_file) {
  var manga_info = loadMangaInfo(path.dirname(saver_file.path), saver_file.name);

  if (!manga_info.last_update && saver_file['mtime']) {
    manga_info.last_update = new Date(saver_file['mtime']);
  }

  manga_info.id = utils.md5Hash(manga_info.path);

  if (manga_info.chapters_count > 0) {
    if (manga_info.chapters.length) {
      sortItems(manga_info.chapters, 'title_lc', 'desc');
    }

    manga_map[manga_info.relpath] = manga_info;
    manga_list.push(manga_info.relpath);
    manga_id_map[manga_info.id] = manga_info.path;
    
    manga_search_list.push({
      name: manga_info.name,
      relpath: manga_info.relpath
    });

    if (manga_info.alt_names && manga_info.alt_names.length) {
      manga_info.alt_names.forEach(function(alt_name) {
        manga_search_list.push({
          name: alt_name,
          relpath: manga_info.relpath
        });
      });
    }

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

    manga_indexing_fields.forEach(function(index_field) {
      if (typeof manga_info[index_field.field] == 'string') {
        addToMangaIndex(index_field.index, manga_info[index_field.field]);
      } else if (Array.isArray(manga_info[index_field.field])) {
        manga_info[index_field.field].forEach(function(item) {
          addToMangaIndex(index_field.index, item);
        });
      }
    });
  }

  return manga_info;
}

var createMangaIndex = function(files) {
  
  var saver_files = files.filter(function(file) {
    return file.name == 'saver.json';
  });

  console.log('Loading manga:', saver_files.length);

  saver_files.forEach(function(saver_file, idx) {
    var manga_info = addManga(saver_file);

    console.log((idx+1) + '/' + saver_files.length, 'Manga:', manga_info.relpath);
  });

  manga_starts_with_list = [];
  for (var first_letter in manga_starts_with_map) {
    manga_starts_with_list.push({name: first_letter, count: manga_starts_with_map[first_letter]});
  }
  sortItems(manga_starts_with_list, 'name', 'asc');

  generateIndexPopularList();

  console.log('Manga loaded:', manga_list.length);
}

///

var resetIndex = function() {
  all_dirs = [];

  dirs_map = {};
  files_map = {};

  file_types_map = {};
  popular_file_types = [];

  all_files = [];
  image_files = [];
  video_files = [];

  manga_list = [];
  manga_map = {};
  manga_id_map = {};
  manga_chapters_map = {};

  manga_list_cache = {};

  manga_searcher = false;
  manga_search_list = [];

  manga_indices = {};

  manga_starts_with_map = {};
  manga_starts_with_list = [];
}

var createIndex = function(dirs, files) {
  createDirsIndex(dirs);
  createFilesIndex(files);
  recalculateDirsSize();

  createMangaIndex(files);
}

var loadIndex = function(callback) {

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

      var file_info = tmp_files_map[file_relpath];

      file_info.path = getAbsPath(file_relpath);

      file_info.name = file_info.filename || file_info.name || path.basename(file_relpath);
      file_info.size = file_info.filesize || file_info.size || 0;
      file_info.type = file_info.filetype || file_info.type || '';

      files.push(file_info);

      var dir_path = path.dirname(file_info.path);
      if (!tmp_dirs_map[dir_path]) {
        tmp_dirs_map[dir_path] = {
          path: dir_path
        }
        dirs.push(tmp_dirs_map[dir_path]);
      }
    }

    resetIndex();

    createIndex(dirs, files);

    return callback();
  } 
  else if (data_dirs.length > 1) {
    var scan_opts = {recursive: true};

    console.log('Scanning input dirs...');

    var dirs = [];
    var files = [];

    async.eachSeries(data_dirs, function(input_dir, cb) {
      console.log('Scan: ' + input_dir);
      fileUtils.scanDir(input_dir, scan_opts, function(err, _files, _dirs) {
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

      resetIndex();

      createIndex(dirs, files);

      return callback();
    });
  }
  else {
    var scan_opts = {recursive: true};

    console.log('Scanning input dir...');
    fileUtils.scanDir(data_dir, scan_opts, function(err, files, dirs) {
      if (err) {
        console.log('Scan dir error!', data_dir);
        console.log(err);
        return callback(err);
      }

      resetIndex();

      createIndex(dirs, files);

      return callback();
    });
  }
}

var reloadIndex = function(callback) {
  if (index_reloading) {
    if (io) io.emit('reload-in-progress');
    return callback(new Error('Index reload in progress.'));
  }

  index_reloading = true;
  if (io) io.emit('reloading');

  loadIndex(function(err) {
    index_reloading = false;
    if (err) {
      console.log('Reload index failed:', err.message);
      if (io) io.emit('reload-error', {error: err.message});
      return callback(err);
    } else {
      if (io) io.emit('reload-success');
      callback();
    }
  });
}

///

var updateManga = function(manga, opts, done) {
  if (typeof opts == 'function') {
    done = opts;
    opts = {};
  }
  if (!manga.relpath) return done(new Error('Missing manga relpath'));

  var manga_dir = getAbsPath(manga.relpath);

  if (!utils.directoryExists(manga_dir)) {
    return done(new Error('Manga dir not found!'));
  }

  console.log('Update manga dir:', manga_dir);

  mangaUpdater.updateMangaDir(manga_dir, {
    cbz: true,
    remove_dir: true,
    ignore_last_update: opts.ignore_last_update
  }, function(err) {
    if (err) {
      return done(err);
    } else {
      if (utils.fileExists(path.join(manga_dir, 'saver.json'))) {
        var manga_info = loadMangaInfo(manga_dir, 'saver.json');

        if (manga_info.chapters_count > 0) {
          if (manga_info.chapters.length) {
            sortItems(manga_info.chapters, 'title_lc', 'desc');
          }

          manga_map[manga_info.relpath] = manga_info;
        }

        done();
      } else {
        done();
      }
    }
  });
}

///

// Load index & start server in the first time
loadIndex(function(err) {
  if (err) {
    process.exit();
  }
  startServer();
});
