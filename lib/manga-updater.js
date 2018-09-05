// lib/manga-updater.js

var prettySeconds = require('pretty-seconds');

var spawn = require('child_process').spawn;
var moment = require('moment');

var JobQueue = require('jul11co-wdt').JobQueue;

var manga_update_queue = new JobQueue();

var executeCommand = function(cmd, args, opts, callback) {
  if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }

  try {
    var command = spawn(cmd, args || [], {maxBuffer: 1024 * 500});
    command.on('error', function (err) {
      console.log('spawn error', err);
      return callback(err);
    });
  } catch (e) {
    console.log(e);
    return callback(e);
  }
  
  var start_time = new Date();

  command.stdout.on('data', function (data) {
    // console.log(data.toString());
    if (opts.verbose) {
      var log_str = data.toString();
      var log_lines = log_str.split('\n');
      if (log_lines.length > 1) {
        log_lines.forEach(function(line) {
          if (line) console.log(line);
        })
      } else {
        console.log(log_str);
      }
    }
  });

  command.stderr.on('data', function (data) {
    // console.log(data.toString());
    if (opts.verbose) {
      var log_str = data.toString();
      var log_lines = log_str.split('\n');
      if (log_lines.length > 1) {
        log_lines.forEach(function(line) {
          if (line) console.error(line);
        })
      } else {
        console.error(log_str);
      }
    }
  });

  command.on('exit', function (code) {
    // console.log('command exited with code ' + code.toString());
    // console.log('elapsed time', moment().diff(moment(start_time), 'seconds'), 'seconds');
    var elapsed_seconds = moment().diff(moment(start_time), 'seconds');
    console.log('elapsed time', prettySeconds(elapsed_seconds));

    if (code !== 0) {
      console.log('command exited with code ' + code.toString());
      callback(new Error('command exited with code ' + code.toString()));
    } else {
      if (opts.verbose) console.log('command exited with code ' + code.toString());
      callback();
    }
  });
}

exports.downloadManga = function(manga_url, output_dir, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var command_args = [
    manga_url,
    output_dir,
    '--force',
    '--quiet'
  ];

  if (options.auto_manga_dir) {
    command_args.push('--auto-manga-dir');
  }
  if (options.group_by_site) {
    command_args.push('--group-by-site');
  }

  if (options.html_proxy) {
    command_args.push('--html-proxy='+options.html_proxy);
  }
  if (options.metadata_only) {
    command_args.push('--metadata-only');
  }
  if (options.cbz) {
    command_args.push('--cbz');
  }
  if (options.remove_dir) {
    command_args.push('--remove-dir');
  }

  var command_opts = {
    verbose: options.verbose
  };

  manga_update_queue.pushJob({
    command_args: command_args,
    command_opts: command_opts
  }, function(args, done) {
    executeCommand('mangadl', args.command_args, args.command_opts, done);
  }, function(err) {
    return callback(err);
  });
}

exports.updateMangaDir = function(manga_dir, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  var command_args = [
    'update',
    manga_dir,
    '--force',
    '--quiet',
    '--cbz'
  ];

  if (options.recursive) {
    command_args.push('--recursive');
  }
  if (options.html_proxy) {
    command_args.push('--html-proxy='+options.html_proxy);
  }
  if (options.metadata_only) {
    command_args.push('--metadata-only');
  }
  if (options.cbz) {
    command_args.push('--cbz');
  }
  if (options.remove_dir) {
    command_args.push('--remove-dir');
  }

  if (options.ignore_last_update) {
    command_args.push('--ignore-last-update');
  }

  var command_opts = {
    verbose: options.verbose
  };

  manga_update_queue.pushJob({
    command_args: command_args,
    command_opts: command_opts
  }, function(args, done) {
    executeCommand('mangadl', args.command_args, args.command_opts, done);
  }, function(err) {
    return callback(err);
  });
}
