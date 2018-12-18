/*!
 * mangaviewer.jul11.co
 * Jul11Co (2015-2018) 
 */
 
window.initViewer = function(opts) {
  opts = opts || {};

  var view_mode = opts.view_mode || 'scroll'; // 'scroll', 'single', 'double'
  var view_direction = opts.view_direction || 'right-to-left'; // 'left-to-right', 'right-to-left'

  var cover_page_enable = false;
  if (opts.cover_page) cover_page_enable = true;

  var first_time_load = true;

  var loaded_images = 0;
  var loaded_pages = 0;
  var total_pages = 0;

  var chapter_page_images = [];
  var chapter_page_images_map = {};

  var chapter_pages = [];
  var chapter_pages_map = {};

  var chapter_page_current = -1;
  var chapter_pages_current = [];

  var current_manga_url = '';
  var current_manga_chapters = [];
  var current_chapter_url = '';

  var current_zoom_mode = 'fit-all'; // 'auto', 'fit-all', 'fit-height', 'fit-width'

  // console.log('View mode:', view_mode);

  var ellipsisMiddle = function(str, max_length, first_part, last_part) {
    if (!max_length) max_length = 65;
    if (!first_part) first_part = 40;
    if (!last_part) last_part = 20;
    if (str.length > max_length) {
      return str.substr(0, first_part) + '...' + str.substr(str.length-last_part, str.length);
    }
    return str;
  }

  var trimText = function(text, max_length) {
    if (!text) text = '';
    if (text.length > max_length) {
      text = text.substring(0, max_length) + '...';
    }
    return text;
  }

  var self = this;

  var showHideViewerControls = function() {
    // toggle top nav
    if ($('#manga-top-nav').hasClass('disappear')) {
      $('#manga-top-nav').css("top", "-60px");
    } else {
      $('#manga-top-nav').css("top", "0px");
    }
    // toggle back to top
    if ($('#back-to-top').hasClass('disappear')) {
      $('#back-to-top').css("bottom", "-60px");
    } else {
      $('#back-to-top').css("bottom", "10px");
    }
    // toggle chapter load progress
    if ($('#chapter-load-progress').hasClass('disappear')) {
      $('#chapter-load-progress').css("bottom", "-60px");
    } else {
      $('#chapter-load-progress').css("bottom", "10px");
    }
    // toggle zoom control
    if ($('#zoom-control').hasClass('disappear')) {
      $('#zoom-control').css("bottom", "-70px");
    } else {
      $('#zoom-control').css("bottom", "40px");
    }
    // hide settings view
    if (!$('#mr-settings-view').hasClass('hidden')) {
      $('#mr-settings-view').addClass('hidden');
    }
  }

  $('#mr-scroll-pages-view').click(function(e) {
    // e.preventDefault();
    $('#manga-top-nav').toggleClass('disappear');
    $('#back-to-top').toggleClass('disappear');
    $('#chapter-load-progress').toggleClass('disappear');
    $('#zoom-control').toggleClass('disappear');
    showHideViewerControls();
  });

  $('#mr-single-page-view').click(function(event) {
    if (view_mode == 'single' || view_mode == 'double') {
      $('#manga-top-nav').toggleClass('hidden');
      $('#mr-single-page-view').toggleClass('hide-topbar');
      $('#zoom-control').toggleClass('disappear');
      $('#chapter-page-nav-left a').toggleClass('disappear');
      $('#chapter-page-nav-right a').toggleClass('disappear');
      showHideViewerControls();
    }
  });

  $('#zoom-control #zoom-in').on('click', function(event) {
    event.preventDefault();
    
    var current_zoom_ratio = 1;
    if (view_mode == 'single' || view_mode == 'double') {
      current_zoom_ratio = $('#single-page-view-content img').first().width()/$('#single-page-view-content').width();
      if (view_mode == 'double' && chapter_pages_current.length == 2) {
        current_zoom_ratio = current_zoom_ratio/2;
      }
    } else {
      current_zoom_ratio = $('#scroll-page-images img').first().width()/$('#scroll-page-images').width();
    }
    // console.log('Current ratio:', current_zoom_ratio);

    var zoom_w_value = $('#zoom-width-value').attr('data-value');
    zoom_w_value = (zoom_w_value == 'auto') ? Math.floor(current_zoom_ratio*100) : zoom_w_value;
    zoom_w_value = parseInt(zoom_w_value);
    if (!isNaN(zoom_w_value)) {
      zoom_w_value += 5;
      // if (zoom_w_value >= 100) {
      //   zoom_w_value = 100;
      //   $('#zoom-control #zoom-in').addClass('disable');
      // } else {
      //   $('#zoom-control #zoom-in').removeClass('disable');
      // }
      saveZoomSettings(zoom_w_value, 'auto');
      applyZoom();
    }
  });

  $('#zoom-control #zoom-out').on('click', function(event) {
    event.preventDefault();

    var current_zoom_ratio = 1;
    if (view_mode == 'single' || view_mode == 'double') {
      current_zoom_ratio = $('#single-page-view-content img').first().width()/$('#single-page-view-content').width();
      if (view_mode == 'double' && chapter_pages_current.length == 2) {
        current_zoom_ratio = current_zoom_ratio/2;
      }
    } else {
      current_zoom_ratio = $('#scroll-page-images img').first().width()/$('#scroll-page-images').width();
    }
    // console.log('Current ratio:', current_zoom_ratio);

    var zoom_w_value = $('#zoom-width-value').attr('data-value');
    zoom_w_value = (zoom_w_value == 'auto') ? Math.floor(current_zoom_ratio*100) : zoom_w_value;
    zoom_w_value = parseInt(zoom_w_value);
    if (!isNaN(zoom_w_value)) {
      zoom_w_value -= 5;
      if (zoom_w_value <= 10) {
        zoom_w_value = 10;
        $('#zoom-control #zoom-out').addClass('disable');
      } else {
        $('#zoom-control #zoom-out').removeClass('disable');
      }
      saveZoomSettings(zoom_w_value, 'auto');
      applyZoom();
    }
  });

  $('#zoom-control #zoom-auto').on('click', function(event) {
    event.preventDefault();
    current_zoom_mode = 'auto';
    if (view_mode == 'single' || view_mode == 'double') {
      saveZoomSettings('auto', 'auto');
    }
    applyZoom();
  });

  $('#zoom-control #zoom-fit-height').on('click', function(event) {
    event.preventDefault();
    current_zoom_mode = 'fit-height';
    if (view_mode == 'single' || view_mode == 'double') {
      saveZoomSettings('auto', 100);
    }
    applyZoom();
  });

  $('#zoom-control #zoom-fit-width').on('click', function(event) {
    event.preventDefault();
    current_zoom_mode = 'fit-width';
    if (view_mode == 'single') {
      saveZoomSettings(100, 'auto');
    } else if (view_mode == 'double') {
      saveZoomSettings(50, 'auto');
    }
    applyZoom();
  });

  $('#zoom-control #zoom-fit-all').on('click', function(event) {
    event.preventDefault();
    current_zoom_mode = 'fit-all';
    if (view_mode == 'single') {
      saveZoomSettings('auto', 'auto');
    } else if (view_mode == 'double') {
      saveZoomSettings('auto', 'auto');
    }
    applyZoom();
  });

  var getImageFileName = function(image_src) {
    var filename = image_src.split('?')[0];
    filename = filename.substring(filename.lastIndexOf('/')+1);
    return filename;
  }

  var saveZoomSettings = function(width, height) {
    $('#zoom-width-value').attr('data-value', width);
    $.cookie("viewer-image-width", width);

    if (height) {
      $('#zoom-height-value').attr('data-value', height);
      $.cookie("viewer-image-height", height);
    }
  }

  var hideZoom = function() {
    // $('#zoom-control').addClass('hidden');
    $('#zoom-control').addClass('disappear');
    $('#zoom-control').css("bottom", "-70px");
  }

  var showZoom = function() {
    // $('#zoom-control').removeClass('hidden');
    $('#zoom-control').removeClass('disappear');
    $('#zoom-control').css("bottom", "40px");
  }

  var resetZoom = function() {
    // $('#zoom-width-value').attr('data-value', '100');
    if (view_mode == 'scroll') {
      $('#scroll-page-images img').css('width', 'auto');
      $('#scroll-page-images img').css('height', 'auto');
    } else if (view_mode == 'single' || view_mode == 'double') {
      $('#single-page-view-content img').css('width', 'auto');
      $('#single-page-view-content img').css('height', 'auto');
    }
    saveZoomSettings('auto', 'auto');
  }

  var applyZoom = function() {
    var zoom_w_value = $('#zoom-width-value').attr('data-value');
    var zoom_h_value = $('#zoom-height-value').attr('data-value');

    if (view_mode == 'scroll') {
      $('#scroll-page-images img').css('width', (zoom_w_value == 'auto') ? 'auto' : zoom_w_value+'%');
      $('#scroll-page-images img').css('height', (zoom_h_value == 'auto') ? 'auto' : zoom_h_value+'%');
    } else if (view_mode == 'single') {
      $('#single-page-view-content img').css('width', (zoom_w_value == 'auto') ? 'auto' : zoom_w_value+'%');
      $('#single-page-view-content img').css('height', (zoom_h_value == 'auto') ? 'auto' : zoom_h_value+'%');
      if (current_zoom_mode.indexOf('fit-') == 0) {
        if (current_zoom_mode == 'fit-all') {
          $('#single-page-view-content img').css('max-width', '100%');
          $('#single-page-view-content img').css('max-height', '100%');
        } else if (current_zoom_mode == 'fit-height') {
          $('#single-page-view-content img').css('max-width', '');
        } else if (current_zoom_mode == 'fit-width') {
          $('#single-page-view-content img').css('max-height', '');
        }
      }
      else if (current_zoom_mode == 'auto') {
        $('#single-page-view-content img').css('max-width', '');
        $('#single-page-view-content img').css('max-height', '');
      }
    } else if (view_mode == 'double') {
      if (zoom_w_value == 'auto') {
        $('#single-page-view-content img').css('width', 'auto');
      } else {
        zoom_w_value = parseInt(zoom_w_value);
        if (zoom_w_value > 50) {
          zoom_w_value = 50;
          $('#zoom-width-value').attr('data-value', zoom_w_value);
          saveZoomSettings(zoom_w_value);
        }

        $('#single-page-view-content img').css('width', zoom_w_value+'%');
      }
      $('#single-page-view-content img').css('height', (zoom_h_value == 'auto') ? 'auto' : zoom_h_value+'%');
      if (current_zoom_mode.indexOf('fit-') == 0) {
        if (current_zoom_mode == 'fit-all') {
          $('#single-page-view-content img').css('max-width', chapter_pages_current.length == 1 ? '100%':'50%');
          $('#single-page-view-content img').css('max-height', '100%');
        } else if (current_zoom_mode == 'fit-height') {
          $('#single-page-view-content img').css('max-width', '');
        } else if (current_zoom_mode == 'fit-width') {
          $('#single-page-view-content img').css('max-height', '');
        }
      }
      else if (current_zoom_mode == 'auto') {
        $('#single-page-view-content img').css('max-width', '');
        $('#single-page-view-content img').css('max-height', '');
      }
    }
  }

  self.changeViewMode = function(mode) {
    if (view_mode != mode) {
      var prev_mode = view_mode;
      view_mode = mode;
      // console.log('Switch view mode:', view_mode);

      // -> scroll
      if (view_mode == 'scroll' && $('#mr-scroll-pages-view').hasClass('hidden')) {
        $('#mr-scroll-pages-view').removeClass('hidden');
        $('#mr-single-page-view').addClass('hidden');
        var zoom_w_value = $('#zoom-width-value').attr('data-value');
        if (zoom_w_value == 'auto') $('#zoom-width-value').attr('data-value', '80');
        // showScrollPagesView();
        setTimeout(showScrollPagesView, 100);
        showZoom();
        applyZoom();
      } else {
        $('#mr-scroll-pages-view').addClass('hidden');
      }

      // -> single
      if (view_mode == 'single' && (prev_mode == 'double' || $('#mr-single-page-view').hasClass('hidden'))) {
        $('#mr-single-page-view').removeClass('hidden');
        chapter_page_current = -1;
        // showSinglePageView();
        setTimeout(showSinglePageView, 100);
        applyZoom();
      } else {
        $('#mr-single-page-view').addClass('hidden');
        $('#manga-top-nav').removeClass('hidden');
        $('#mr-single-page-view').removeClass('hide-topbar');
      }

      // -> double
      if (view_mode == 'double' && (prev_mode == 'single' || $('#mr-single-page-view').hasClass('hidden'))) {
        $('#mr-single-page-view').removeClass('hidden');
        chapter_page_current = -1;
        // showSinglePageView();
        setTimeout(showSinglePageView, 100);
        applyZoom();
      } else {
        $('#mr-single-page-view').addClass('hidden');
        $('#manga-top-nav').removeClass('hidden');
        $('#mr-single-page-view').removeClass('hide-topbar');
      }

      if (view_mode == 'scroll') {
        $('#zoom-fit-height').addClass('hidden');
        $('#zoom-fit-width').addClass('hidden');
        $('#zoom-fit-all').addClass('hidden');
        $('#zoom-auto').addClass('hidden');
      } else {
        $('#zoom-fit-height').removeClass('hidden');
        $('#zoom-fit-width').removeClass('hidden');
        $('#zoom-fit-all').removeClass('hidden');
        $('#zoom-auto').removeClass('hidden');
      }

    }
  }

  self.changeViewDirection = function(direction) {
    view_direction = direction;
    if (view_direction == 'left-to-right') {
      $('#chapter-page-nav-left a').attr('title', 'Prev page (Left)');
      $('#chapter-page-nav-right a').attr('title', 'Next page (Right)');
    } else {
      $('#chapter-page-nav-left a').attr('title', 'Next page (Left)');
      $('#chapter-page-nav-right a').attr('title', 'Prev page (Right)');
    }
  }

  self.enableCoverPage = function() {
    if (!cover_page_enable) {
      cover_page_enable = true;
      // Re-render pages
      if (view_mode == 'double') {
        chapter_page_current = -1;
        setTimeout(showSinglePageView, 100);
        applyZoom();
        showZoom();
      }
    }
  }

  self.disableCoverPage = function() {
    if (cover_page_enable) {
      cover_page_enable = false;
      // Re-render pages
      if (view_mode == 'double') {
        chapter_page_current = -1;
        setTimeout(showSinglePageView, 100);
        applyZoom();
        showZoom();
      }
    }
  }

  // comps: {KEY: VALUE,...}
  var buildQueryComponent = function(comps) {
    var params = Object.assign({}, comps);
    var param_array = [];
    for (var key in params) {
      param_array.push('' + key + '=' + encodeURIComponent(params[key]));
    }
    return (param_array.join('&'));
  }

  var scrapeLinkAjax = function(link, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }
    
    var url = '/viewer_json?' + buildQueryComponent({path: link}) + '&reader=1';
    if (options.cache) url += '&cache=1';

    $.getJSON(url, function (res){
      // console.log(res);
      callback(null, {page: res.page});
    }).fail (function (err){
      console.log(err);
      callback(err);
    });
  }

  var renderChapterPageImages = function(images) {
    // console.log('renderChapterPageImages:', images.length);

    for (var i = 0; i < images.length; i++) {
      if (typeof images[i] == 'string' && !chapter_page_images_map[images[i]]) {
        chapter_page_images_map[images[i]] = 1;
        chapter_page_images.push({
          src: images[i], 
          scroll: false,
        })
      } else if (typeof images[i] == 'object' && !chapter_page_images_map[images[i].src]) {
        chapter_page_images_map[images[i].src] = 1;
        chapter_page_images.push({
          src: images[i].src,
          scroll: false,
        })
      }
    }

    // console.log('Chapter page images:', chapter_page_images.length);

    if (view_mode == 'scroll') {
      showScrollPagesView();
    } else if (view_mode == 'single') {
      showSinglePageView();
    } else if (view_mode == 'double') {
      showSinglePageView();
    }
  }

  var showScrollPagesView = function() {
    // console.log('showScrollPagesView');

    if ($('#mr-scroll-pages-view').hasClass('hidden')) {
      $('#mr-scroll-pages-view').removeClass('hidden');
    }

    if ($('#scroll-page-images img').length != chapter_page_images.length) {
      for (var i = 0; i < chapter_page_images.length; i++) {
        if (chapter_page_images[i].scroll) continue;
        chapter_page_images[i].scroll = true;

        $('#scroll-page-images').append(
          '<img class="lazy" src="data:image/gif;base64,R0lGODdhAQABAPAAAMPDwwAAACwAAAAAAQABAAACAkQBADs=" ' +
            'data-src="' + chapter_page_images[i].src + '" ' +
            'style="min-height:250px;">'
        );
      }

      applyZoom();
      // loaded_pages = $('#scroll-page-images img').length;
      $('#chapter-load-progress').text('' + loaded_images + '/' + loaded_pages + '/' + total_pages);
      $("#scroll-page-images img.lazy").Lazy({
        afterLoad: function() {
          loaded_images++;
          $('#chapter-load-progress').text('' + loaded_images + '/' + loaded_pages + '/' + total_pages);

          if (loaded_images >= chapter_page_images.length-4 && loaded_pages < chapter_pages.length) {
            var min_page_idx = Math.min(loaded_images, chapter_pages.length-1);
            var max_page_idx = Math.min(loaded_images+2, chapter_pages.length-1);
            loadChapterPages(chapter_pages, min_page_idx, max_page_idx);
          }
        }
      });
    }
  }

  var renderSinglePageView = function(current_image) {
    $('#single-page-view-content').scrollTop(0);
    $('#single-page-view-content').html(
      '<span class="single-page-filler"></span>' +
      '<img class="single-page-image" ' +
        'src="' + current_image.src + '" style="min-height:50px;max-width:100%;">'
    );
    applyZoom();
    // $("#single-page-view-content img.lazy").Lazy();
  }

  var renderDoublePageView = function(image1, image2) {
    $('#single-page-view-content').scrollTop(0);
    var page_view_html = '<span class="single-page-filler"></span>';

    if (image2) {
      page_view_html += '<img id="double-page-left" class="single-page-image" ' +
        'src="" alt="" style="min-height:50px;max-width:50%;">';
      page_view_html += '<img id="double-page-right" class="single-page-image" ' + 
        'src="" alt="" style="min-height:50px;max-width:50%;">';

      $('#single-page-view-content').html(page_view_html);

      if (view_direction == 'right-to-left') {
        // load double-page-right first
        $('#double-page-right').unbind('load');
        $('#double-page-right').on('load', function() {
          $('#double-page-left').attr('src', image2.src);
        });
        $('#double-page-right').attr('src', image1.src);
      } else { // 'left-to-right'
        // load double-page-left first
        $('#double-page-left').unbind('load');
        $('#double-page-left').on('load', function() {
          $('#double-page-right').attr('src', image2.src);
        });
        $('#double-page-left').attr('src', image1.src);
      }
    } else {
      page_view_html += '<img class="single-page-image" ' +
        'src="' + image1.src + '" alt="" style="min-height:50px;max-width:100%;">';

      $('#single-page-view-content').html(page_view_html);
    }

    applyZoom();
    // $("#single-page-view-content img.lazy").Lazy();
  }

  var preloadSinglePageImage = function(preload_image) {
    var preloadImage = new Image();
    preloadImage.src = preload_image.src;
    // console.log('Preload:', preload_image.src);
    
    preloadImage.addEventListener('load', function() {
      // console.log('Image preloaded: ' + this.width + 'x' + this.height + ' ' + preload_image.src);
      preload_image.width = this.width;
      preload_image.height = this.height;
    });
  }

  var renderCurrentPageView = function() {
    // console.log('renderCurrentPageView:', view_mode, chapter_page_current);

    chapter_pages_current = [];
    var preload_images = [];

    if (view_mode == 'single' && chapter_page_images.length) {
      var current_image = chapter_page_images[chapter_page_current];
      if (!current_image) return;

      // console.log('Load:', current_image.src);
      // console.log(current_image);

      chapter_pages_current = [chapter_page_current];
      renderSinglePageView(current_image);

      if (chapter_page_current < chapter_page_images.length-1) {
        preload_images.push(chapter_page_images[chapter_page_current+1]);
      }      
      if (chapter_page_current < chapter_page_images.length-2) {
        preload_images.push(chapter_page_images[chapter_page_current+2]);
      }
    } else if (view_mode == 'double' && chapter_page_images.length) {
      var current_image = chapter_page_images[chapter_page_current];
      if (!current_image) return;

      // console.log('Load:', current_image.src);
      // console.log(current_image);
      
      chapter_pages_current = [chapter_page_current];

      if ((chapter_page_current > 0 && chapter_page_current < chapter_page_images.length-1) 
        || (chapter_page_current == 0 && !cover_page_enable)) {
        var next_image = chapter_page_images[chapter_page_current+1];
        // console.log('Load:', next_image.src);
        // console.log(next_image);

        if (current_image.width && current_image.height && current_image.width > current_image.height) {
          // Render current image
          renderSinglePageView(current_image);

          if (next_image) {
            preload_images.push(next_image);
          }
        } else if (next_image && next_image.width && next_image.height && next_image.width > next_image.height) {
          // Render current image
          renderSinglePageView(current_image);

          if (next_image) {
            preload_images.push(next_image);
          }
        } else {
          chapter_pages_current.push(chapter_page_current+1);
          renderDoublePageView(current_image, next_image);
        }

      } else {
        renderSinglePageView(current_image);
        
        if (chapter_page_current < chapter_page_images.length-1) {
          preload_images.push(chapter_page_images[chapter_page_current+1]);
        }
      }

      if (chapter_page_current < chapter_page_images.length-2) {
        preload_images.push(chapter_page_images[chapter_page_current+2]);
      }
      if (chapter_page_current < chapter_page_images.length-3) {
        preload_images.push(chapter_page_images[chapter_page_current+3]);
      }
    }

    if (preload_images.length) {
      setTimeout(function() {
        preload_images.forEach(function(image) {
          preloadSinglePageImage(image);
        });
      }, 1000);
    }

    if (((view_mode == 'single' && chapter_page_current == chapter_page_images.length-1)
      ||(view_mode == 'double' && chapter_page_current >= chapter_page_images.length - chapter_pages_current.length)) 
      && isLastChapter(current_chapter_url)) { 
      // last page (of last chapter)
      // next page nav will be hidden
      if (view_direction == 'left-to-right') { // right == next
        $('#chapter-page-nav-right a').addClass('hidden');
        $('#chapter-page-nav-left a').removeClass('hidden');
      } else if (view_direction == 'right-to-left') { // left == next
        $('#chapter-page-nav-left a').addClass('hidden');
        $('#chapter-page-nav-right a').removeClass('hidden');
      }
    } else if (chapter_page_current == 0 && isFirstChapter(current_chapter_url)) { 
      // first page (of first chapter)
      // previous page nav will be hidden
      if (view_direction == 'left-to-right') { // left == previous
        $('#chapter-page-nav-left a').addClass('hidden');
        $('#chapter-page-nav-right a').removeClass('hidden');
      } else if (view_direction == 'right-to-left') { // right == previous
        $('#chapter-page-nav-right a').addClass('hidden');
        $('#chapter-page-nav-left a').removeClass('hidden');
      }
    } else {
      $('#chapter-page-nav-right a').removeClass('hidden');
      $('#chapter-page-nav-left a').removeClass('hidden');
    }
  }

  var updateSinglePageProgress = function(current, total) {
    if (Array.isArray(current) && current.length == 2) {
      $('#single-page-progress').text(current[0] + ' - ' + current[1] + ' of ' + total);
    } else if (typeof current == 'number') {
      $('#single-page-progress').text(current + ' of ' + total);
    }
  }

  var showSinglePageView = function() {
    // console.log('showSinglePageView');

    if ($('#mr-single-page-view').hasClass('hidden')) {
      $('#mr-single-page-view').removeClass('hidden');
    }

    if (view_mode == 'single' && chapter_page_images.length) {
      if (chapter_page_current == -1) {
        chapter_page_current = 0;
        renderCurrentPageView(); // display first page
      }
      // $('#single-page-progress').text((chapter_page_current+1) + ' of ' + chapter_page_images.length
      //   /*+ ' (' + chapter_pages.length + ')'*/);
      updateSinglePageProgress((chapter_page_current+1), chapter_page_images.length);
    } else if (view_mode == 'double' && chapter_page_images.length) {
      if (chapter_page_current == -1) {
        chapter_page_current = 0;
        renderCurrentPageView(); // display first page
      }
      if (chapter_page_current < chapter_page_images.length-1 && chapter_pages_current.length == 2) {
        // $('#single-page-progress').text((chapter_page_current+1) + ' - ' + (chapter_page_current+2) 
        //   + ' of ' + chapter_page_images.length
        //   /* + ' (' + chapter_pages.length + ')'*/);
        updateSinglePageProgress([chapter_page_current+1, chapter_page_current+2], chapter_page_images.length);
      } else {
        // $('#single-page-progress').text((chapter_page_current+1) + ' of ' + chapter_page_images.length
        //   /*+ ' (' + chapter_pages.length + ')'*/);
        updateSinglePageProgress((chapter_page_current+1), chapter_page_images.length);
      }
    }
  }

  var renderNextChapterPageImage = function() {
    if (view_mode == 'single' && chapter_page_images.length 
      && chapter_page_current < chapter_page_images.length-1) {
      chapter_page_current++;
    
      renderCurrentPageView();

      // $('#single-page-progress').text((chapter_page_current+1) + ' of ' + chapter_page_images.length
      //   /*+ ' (' + chapter_pages.length + ')'*/);
      updateSinglePageProgress((chapter_page_current+1), chapter_page_images.length);
    } else if (view_mode == 'double' && chapter_page_images.length) {
      if (chapter_page_current+chapter_pages_current.length >= chapter_page_images.length) {
        chapter_page_current = chapter_page_images.length-1;
        return;
      }
      if (chapter_page_current < chapter_page_images.length-2) chapter_page_current+=chapter_pages_current.length;
      else chapter_page_current = chapter_page_images.length-1;

      renderCurrentPageView();

      if (chapter_page_current < chapter_page_images.length-1 && chapter_pages_current.length == 2) {
        // $('#single-page-progress').text((chapter_page_current+1) + ' - ' + (chapter_page_current+2) 
        //   + ' of ' + chapter_page_images.length
        //   /* + ' (' + chapter_pages.length + ')'*/);
        updateSinglePageProgress([chapter_page_current+1,chapter_page_current+2], chapter_page_images.length);
      } else {
        // $('#single-page-progress').text((chapter_page_current+1) + ' of ' + chapter_page_images.length
        //   /*+ ' (' + chapter_pages.length + ')'*/);
        updateSinglePageProgress((chapter_page_current+1), chapter_page_images.length);
      }
    }
  }

  var renderPrevChapterPageImage = function() {
    if (view_mode == 'single' && chapter_page_images.length && chapter_page_current > 0) {
      chapter_page_current--;

      renderCurrentPageView();

      // $('#single-page-progress').text((chapter_page_current+1) + ' of ' + chapter_page_images.length
      //    /*+ ' (' + chapter_pages.length + ')'*/);
      updateSinglePageProgress((chapter_page_current+1), chapter_page_images.length);
    } else if (view_mode == 'double' && chapter_page_images.length) {
      if (chapter_page_current == 0) {
        return;
      }
      if (chapter_page_current > 1) chapter_page_current-=2;
      else chapter_page_current = 0;

      renderCurrentPageView();

      if (chapter_page_current > 0 && chapter_pages_current.length == 2) {
        // $('#single-page-progress').text((chapter_page_current+1) + ' - '  + (chapter_page_current+2) 
        //   + ' of ' + chapter_page_images.length
        //   /*+ ' (' + chapter_pages.length + ')'*/);
        updateSinglePageProgress([chapter_page_current+1,chapter_page_current+2], chapter_page_images.length);
      } else {
        // $('#single-page-progress').text((chapter_page_current+1) + ' of ' + chapter_page_images.length 
        //   /* +  ' (' + chapter_pages.length + ')'*/);
        updateSinglePageProgress((chapter_page_current+1), chapter_page_images.length);
      }
    }
  }

  var nextChapterPage = function() {
    if (chapter_page_current < chapter_pages.length-1) {
      var min_page_idx = Math.min(chapter_page_current+1, chapter_pages.length-1);
      var max_page_idx = Math.min(chapter_page_current+2, chapter_pages.length-1);

      return loadChapterPages(chapter_pages, min_page_idx, max_page_idx, function() {
        renderNextChapterPageImage();

        // preload more 2 pages
        min_page_idx = Math.min(chapter_page_current+3, chapter_pages.length-1);
        max_page_idx = Math.min(chapter_page_current+4, chapter_pages.length-1);
        loadChapterPages(chapter_pages, min_page_idx, max_page_idx);
      });
    } else if (!isLastChapter(current_chapter_url)) {
      if ((view_mode == 'single' && chapter_page_current == chapter_pages.length-1) 
        || (view_mode == 'double' && chapter_page_current >= (chapter_pages.length-chapter_pages_current.length))) {
        // last page
        return loadNextChapter();
      }
    }
  }

  var prevChapterPage = function() {
    if (chapter_page_current > 0) {
      var min_page_idx = Math.max(0, chapter_page_current-2);
      var max_page_idx = Math.max(chapter_page_current-1, 0);

      return loadChapterPages(chapter_pages, min_page_idx, max_page_idx, function() {
        renderPrevChapterPageImage();

        // preload more 2 pages
        min_page_idx = Math.max(0, chapter_page_current-4);
        max_page_idx = Math.max(chapter_page_current-3, 0);
        loadChapterPages(chapter_pages, min_page_idx, max_page_idx);
      });
    } else if ((chapter_page_current == 0) && !isFirstChapter(current_chapter_url)) { 
      // first page
      return loadPreviousChapter();
    }
  }

  var closeSinglePageView = function() {
    if (view_mode != 'single' && view_mode != 'double') return;
    if (!$('#mr-single-page-view').hasClass('hidden')) {
      $('#mr-single-page-view').addClass('hidden');
    }
  }

  $('#chapter-page-nav-right').on('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    if (view_direction == 'left-to-right') nextChapterPage();
    else if (view_direction == 'right-to-left') prevChapterPage();
  });
  $('#chapter-page-nav-left').on('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    if (view_direction == 'left-to-right') prevChapterPage();
    else if (view_direction == 'right-to-left') nextChapterPage();
  });

  $('#single-page-close a').bind('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    closeSinglePageView();
  });

  $(document).on('keydown', function (event) {
    if (view_mode == 'single' || view_mode == 'double') {
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      var keycode = event.keyCode || event.which;
      if (keycode == 37) { // left
        event.preventDefault();
        if (view_direction == 'left-to-right') prevChapterPage();
        else if (view_direction == 'right-to-left') nextChapterPage();
      } else if (keycode == 39) { // right
        event.preventDefault();
        if (view_direction == 'left-to-right') nextChapterPage();
        else if (view_direction == 'right-to-left') prevChapterPage();
      }
    }
  });

  var loadChapterPage = function(chapter_page, callback) {
    callback = callback || function() {};

    // console.log('loadChapterPage');

    if (!chapter_page) {
      return callback();
    }
    if (chapter_pages_map[chapter_page.url] 
      && (chapter_pages_map[chapter_page.url].loaded || chapter_pages_map[chapter_page.url].loading)) {
      return callback();
    }

    chapter_pages_map[chapter_page.url].loading = true;

    console.log('loadChapterPage: url=' + chapter_page.url);

    scrapeLinkAjax(chapter_page.url, {cache: true}, function(err, result) {
      if (err) {
        console.log(err);
        return callback(err);
      }

      // console.log(result);

      if (chapter_pages_map[chapter_page.url] && chapter_pages_map[chapter_page.url].loaded) {
        return callback();
      }

      loaded_pages++;
      $('#chapter-load-progress').text('' + loaded_images + '/' + loaded_pages + '/' + chapter_pages.length);

      if (chapter_pages_map[chapter_page.url]) {
        chapter_pages_map[chapter_page.url].loaded = true;
        chapter_pages_map[chapter_page.url].loading = false;
      } else {
        chapter_pages_map[chapter_page.url] = {
          url: chapter_page.url,
          loaded: true
        };
      }

      if (result && result.page && result.page.manga && result.page.manga.images) {
        renderChapterPageImages(result.page.manga.images);
      }

      return callback();
    });
  }

  var loadChapterPages = function(chapter_pages, from_index, to_index, callback) {
    callback = callback || function() {};

    if (typeof chapter_pages == 'undefined' || chapter_pages.length == 0) {
      return callback();
    }

    // console.log('loadChapterPages:', 'from_index='+from_index, 'to_index='+to_index);

    $('#chapter-loading').removeClass('hidden');

    var current_index = from_index;

    var loadChapterPageCallback = function(err, preloaded) {
      if (err) {
        console.log(err);
      }

      if (to_index < chapter_pages.length && current_index <= to_index) {
        current_index = current_index+1;

        var chapter_page = chapter_pages[current_index];
        if (!chapter_page || (chapter_pages_map[chapter_page.url] && chapter_pages_map[chapter_page.url].loaded)) {
          return loadChapterPageCallback();
        }

        setTimeout(function() {
          loadChapterPage(chapter_page, loadChapterPageCallback);
        }, 1000);
      } else {
        $('#chapter-loading').addClass('hidden');
        return callback();
      }
    }

    loadChapterPage(chapter_pages[current_index], loadChapterPageCallback);
  }

  var getChapterIndex = function(chapter_url) {
    if (current_manga_chapters && current_manga_chapters.length) {
      var manga_chapters = current_manga_chapters;
      var chapter_idx = -1;
      for (var i = 0; i < manga_chapters.length; i++) {
        if (manga_chapters[i].url == chapter_url) {
          chapter_idx = i;
          break;
        }
      }
      return chapter_idx;
    } else {
      return -1;
    }
  }

  var isLastChapter = function(chapter_url) {
    if (current_manga_chapters && current_manga_chapters.length) {
      return (getChapterIndex(chapter_url) == 0);
    } else {
      return false;
    }
  }

  var isFirstChapter = function(chapter_url) {
    if (current_manga_chapters && current_manga_chapters.length) {
      return (getChapterIndex(chapter_url) == current_manga_chapters.length-1);
    } else {
      return false;
    }
  }

  var loadNextChapter = function() {
    if (current_manga_chapters && current_manga_chapters.length) {
      var current_chapter_idx = getChapterIndex(current_chapter_url);
      var next_chapter = (current_chapter_idx > 0) ? current_manga_chapters[current_chapter_idx-1] : null;
      if (next_chapter) {
        // console.log('loadNextChapter:', next_chapter.url);
        loadMangaChapter(next_chapter.url);
      }
    }
  }

  var loadPreviousChapter = function() {
    if (current_manga_chapters && current_manga_chapters.length) {
      var current_chapter_idx = getChapterIndex(current_chapter_url);
      var previous_chapter = (current_chapter_idx < current_manga_chapters.length-1) 
        ? current_manga_chapters[current_chapter_idx+1] : null;
      if (previous_chapter) {
        // console.log('loadPreviousChapter:', previous_chapter.url);
        loadMangaChapter(previous_chapter.url);
      }
    }
  }

  var loadMangaChapter = function(chapter_url) {

    console.log('loadMangaChapter:', chapter_url);

    // Setting value does not cause the dispatch of the `change` event. 
    $('#chapter-list select').val(chapter_url);

    $('#mr-scraper-async-loading').removeClass('hidden');

    scrapeLink(chapter_url, function(err) {
      $('#mr-scraper-async-loading').addClass('hidden');

      if (!err) {
        if (current_manga_chapters && current_manga_chapters.length) {
          var manga_chapters = current_manga_chapters;

          // select chapter
          // $('#chapter-list select option[value="' + current_chapter_url + '"]').attr('selected', 'selected');
          $('#chapter-list select').val(current_chapter_url);

          // console.log('Current chapter URL:', current_chapter_url);

          var current_chapter_idx = -1;
          for (var i = 0; i < manga_chapters.length; i++) {
            if (manga_chapters[i].url == current_chapter_url) {
              current_chapter_idx = i;
              break;
            }
          }

          if (current_chapter_idx >= 0) {
            // change chapter-next
            
            var next_chapter = (current_chapter_idx > 0) ? manga_chapters[current_chapter_idx-1] : null;
            if (next_chapter) {
              $('#chapter-next').attr('href', '/viewer?' + buildQueryComponent({path: next_chapter.url}));
              $('#chapter-next').attr('data-chapter-url', next_chapter.url);
              $('#chapter-next').attr('title', next_chapter.title);
              $('#chapter-next').removeClass('disable');
            } else {
              $('#chapter-next').attr('href', '#');
              $('#chapter-next').attr('data-chapter-url', '');
              $('#chapter-next').attr('title', 'No next chapter');
              $('#chapter-next').addClass('disable');
            }

            // change chapter-previous
            var previous_chapter = (current_chapter_idx < manga_chapters.length-1) 
              ? manga_chapters[current_chapter_idx+1] : null;
            if (previous_chapter) {
              $('#chapter-previous').attr('href', '/viewer?' + buildQueryComponent({link: previous_chapter.url}));
              $('#chapter-previous').attr('data-chapter-url', previous_chapter.url);
              $('#chapter-previous').attr('title', previous_chapter.title);
              $('#chapter-previous').removeClass('disable');
            } else {
              $('#chapter-previous').attr('href', '#');
              $('#chapter-previous').attr('data-chapter-url', '');
              $('#chapter-previous').attr('title', 'No previous chapter');
              $('#chapter-previous').addClass('disable');
            }
          }
        }
      }
    });
  }

  var renderChapterList = function(manga_chapters) {

    // console.log('renderChapterList:', 'chapters: ' + manga_chapters.length);

    $('#chapter-list select').html('');

    var current_chapter_idx = -1;

    for (var i = 0; i < manga_chapters.length; i++) {
      var chapter = manga_chapters[i];
      if (chapter.url == current_chapter_url) {
        current_chapter_idx = i;
        $('#chapter-list select').append('<option value="' + chapter.url + '" selected>' + 
          ellipsisMiddle(chapter.title, 100) + '</option>');
      } else {
        $('#chapter-list select').append('<option value="' + chapter.url + '">' + 
          ellipsisMiddle(chapter.title, 100) + '</option>'); 
      }
    }

    if (manga_chapters.length > 0) {
      $('#chapter-list').css('visibility','visible');
    }

    if (current_chapter_idx < manga_chapters.length - 1) {
      var previous_chapter = manga_chapters[current_chapter_idx + 1];

      $('#chapter-previous').attr('href', '/viewer?' + buildQueryComponent({path: previous_chapter.url}));
      $('#chapter-previous').attr('data-chapter-url', previous_chapter.url);
      $('#chapter-previous').attr('title', previous_chapter.title);
      // $('#chapter-previous').css('visibility','visible');
      $('#chapter-previous').removeClass('disable');
    } else {
      $('#chapter-previous').attr('href', '#');
      $('#chapter-previous').attr('data-chapter-url', '');
      $('#chapter-previous').attr('title', 'No previous chapter');
      // $('#chapter-previous').css('visibility','hidden');
      $('#chapter-previous').addClass('disable');
    }

    if (current_chapter_idx > 0) {
      var next_chapter = manga_chapters[current_chapter_idx - 1];

      $('#chapter-next').attr('href', '/viewer?' + buildQueryComponent({path: next_chapter.url}));
      $('#chapter-next').attr('data-chapter-url', next_chapter.url);
      $('#chapter-next').attr('title', next_chapter.title);
      // $('#chapter-next').css('visibility','visible');
      $('#chapter-next').removeClass('disable');
    } else {
      $('#chapter-next').attr('href', '#');
      $('#chapter-next').attr('data-chapter-url', '');
      $('#chapter-next').attr('title', 'No next chapter');
      // $('#chapter-next').css('visibility','hidden');
      $('#chapter-next').addClass('disable');
    }

    $('#chapter-previous').unbind('click');
    $('#chapter-previous').on('click', function(event) {
      event.preventDefault();
      var chapter_url = $(this).attr('data-chapter-url');
      if (chapter_url) loadMangaChapter(chapter_url);
    });

    $('#chapter-next').unbind('click');
    $('#chapter-next').on('click', function(event) {
      event.preventDefault();
      var chapter_url = $(this).attr('data-chapter-url');
      if (chapter_url) loadMangaChapter(chapter_url);
    });

    // select change event
    $('#chapter-list select').change(function() {
      var chapter_url = $('#chapter-list select').val();
      // console.log('Selected chapter change:', chapter_url);
      // window.location = '/viewer?' + buildQueryComponent({path: chapter_url});
      loadMangaChapter(chapter_url);
    });
  } 

  var loadChapterList = function(manga_link, callback) {
    callback = callback || function() {};

    // console.log('loadChapterList:', manga_link);
    
    if (typeof manga_link == 'undefined' || manga_link == '') {
      return callback();
    }

    scrapeLinkAjax(manga_link, function(err, result) {
      if (err) {
        console.log(err);
        return callback(err);
      }
      
      // console.log(result);

      if (result && result.page && result.page.manga && result.page.manga.chapters 
        && result.page.manga.chapters.length >= 1) {
      
        $('#manga-top-form').addClass('hidden');
        $('#manga-chapter-nav').removeClass('hidden');

        if (result.page.manga.url && result.page.manga.name) {
          // var manga_url = result.page.manga.url;
          var manga_url = '/manga?path=' + encodeURIComponent(result.page.manga.url);
          $('#manga-title').html('<a href="' + manga_url + '">' + trimText(result.page.manga.name,40) + '</a> »');
        }

        renderChapterList(result.page.manga.chapters);

        callback(null, result.page.manga.chapters);
      } else {
        callback();
      }
    });
  }

  var loadManga = function(manga_info) {
    console.log(manga_info);

    if (manga_info.url && manga_info.name) {
      // var manga_url = manga_info.url;
      var manga_url = '/manga?path=' + encodeURIComponent(manga_info.url);
      $('#manga-title').html('<a href="' + manga_url + '">' + trimText(manga_info.name,40) + '</a> »');
    }
    
    // if (manga_info.chapter_title) {
    //   $('#chapter-title').html(manga_info.chapter_title);
    // }

    if (manga_info.chapter_url) {
      // console.log('Chapter:', manga_info.chapter_url, manga_info.chapter_title);
      current_chapter_url = manga_info.chapter_url;
    }

    if (typeof manga_info.url != 'undefined') {
      if (!current_manga_url) {
        current_manga_url = manga_info.url;
        current_manga_chapters = [];
      } else if (current_manga_url && current_manga_url != manga_info.url) {
        current_manga_url = manga_info.url;
        current_manga_chapters = [];
      }
    }
    
    if (typeof manga_info.chapter_pages != 'undefined' && manga_info.chapter_pages.length > 0) {
      manga_info.chapter_pages.forEach(function(chapter_page) {
        if (!chapter_pages_map[chapter_page.url]) {
          chapter_pages_map[chapter_page.url] = Object.assign({}, chapter_page);
          chapter_pages.push(chapter_page);
        }
      });

      // console.log(chapter_pages);
      // console.log('Chapter pages: ' + chapter_pages.length);
      total_pages = chapter_pages.length;

      $('#chapter-load-progress').text('' + loaded_images + '/' + loaded_pages + '/' + total_pages);

      loadChapterPages(chapter_pages, 0, Math.min(4, chapter_pages.length-1)); // load first 4 pages
    }

    if (typeof manga_info.images != 'undefined' && manga_info.images.length) {
      if (!manga_info.chapter_pages) { // only images returned
        manga_info.images.forEach(function(chapter_image) {
          var chapter_page_src = (typeof chapter_image == 'string') ? chapter_image : chapter_image.src;

          if (chapter_page_src && !chapter_pages_map[chapter_page_src]) {
            chapter_pages.push({
              url: chapter_page_src
            });
            loaded_pages++;
            chapter_pages_map[chapter_page_src] = {
              url: chapter_page_src,
              loaded: true
            };
          }
        });

        // console.log(chapter_pages);
        // console.log('Chapter pages: ' + chapter_pages.length);
        total_pages = chapter_pages.length;

        $('#chapter-load-progress').text('' + loaded_images + '/' + loaded_pages + '/' + total_pages);
      }

      renderChapterPageImages(manga_info.images);
    }

    if (current_manga_url && current_manga_chapters.length == 0) {
      loadChapterList(current_manga_url, function(err, manga_chapters) {
        if (manga_chapters) {
          current_manga_chapters = manga_chapters.slice();
        }

        if (!manga_info.chapter_url && manga_chapters && manga_chapters.length > 0) {
          // window.location = '/viewer?' + buildQueryComponent({path: manga_chapters[0].url});
          loadMangaChapter(manga_chapters[0].url);
        }
      });
    } 
  }

  var updateResultPage = function(page) {
    if (page.manga && page.manga.chapter_title) {
      if (page.manga.name) {
        document.title = page.manga.name + ' - ' + page.manga.chapter_title + ' | MangaViewer';
      } else {
        document.title = page.manga.chapter_title + ' | MangaViewer';
      }
    } else {
      document.title = page.title + ' | MangaViewer';
    }
    if (!first_time_load) {
      window.history.pushState({}, document.title, '/viewer?' + buildQueryComponent({path: page.url}));
    } else {
      first_time_load = false; // reset
    }

    // console.log(page);

    $('#mr-input-link').val(page.url);
    // Page content
    if (page.manga) {
      loaded_images = 0;
      loaded_pages = 0;
      total_pages = 0;
      chapter_page_images = [];
      chapter_page_images_map = {};
      chapter_pages = [];
      chapter_pages_map = {};
      chapter_page_current = -1;
      chapter_pages_current = [];

      loadManga(page.manga);
    } else if (page.html) {
      $('#mr-page-content').html(page.html);
      $('#mr-page-content').removeClass('hidden');
    }
  }

  var scrapeLink = function(link, callback) {
    $('#mr-result-error').addClass('hidden');
    $('#mr-scraper-async-loading').removeClass('hidden');
    $('#mr-main-content').addClass('hidden');
    $('#mr-page-content').html('');
    $('#scroll-page-images').html('');
    $('#single-page-view-content').html('');

    scrapeLinkAjax(link, function(err, result) {
      $('#mr-scraper-async-loading').addClass('hidden');
      $('#mr-main-content').removeClass('hidden');
      if (err) {
        console.log(err);
        $('#mr-result-error-content').html('Error: ' + err);
        $('#mr-result-error').removeClass('hidden');
      }
      if (!err && result) {
        if (result.error) {
          $('#mr-result-error-content').html('Error: ' + result.error.message);
          $('#mr-result-error').removeClass('hidden');
        }
        if (result.page) {
          updateResultPage(result.page);
        }
      }
      if (callback) callback(err, result);
    });
  }

  var doScrapeLink = function() {
    var link = $('#mr-input-link').val();
    if (!link || link === '') return;
    // if (!isValidURL(link)) {
    //   link = 'http://' + link;
    //   $('#mr-input-link').val(link);
    // }
    scrapeLink(link);
  }

  self.start = function() {
    doScrapeLink();
  } 

  $('#chapter-link-edit').on('click',function(e){
    e.preventDefault();
    $('#manga-chapter-nav').addClass('hidden');
    $('#manga-top-form').removeClass('hidden');
  })

  $('#mr-input-form').submit(function(e) {
    e.preventDefault();
    // doScrapeLink();
    var link = $('#mr-input-link').val();
    if (!link || link === '') return;
    // if (!isValidURL(link)) {
    //   link = 'http://' + link;
    //   $('#mr-input-link').val(link);
    // }
    window.location.href = '/viewer?' + buildQueryComponent({path: link});
  });

  $('#mr-scraper-async').on('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    // doScrapeLink();
    var link = $('#mr-input-link').val();
    if (!link || link === '') return;
    // if (!isValidURL(link)) {
    //   link = 'http://' + link;
    //   $('#mr-input-link').val(link);
    // }
    window.location.href = '/viewer?' + buildQueryComponent({path: link});
  });

  return self;
};
