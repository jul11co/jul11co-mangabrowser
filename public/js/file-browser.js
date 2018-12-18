$(document).ready(function() {

  $('.item-menu-dropdown').on('click', function(event) {
    event.stopPropagation();
  });

  $('.item-menu-dropdown a').on('click', function(event) {
    $(this).closest(".dropdown-menu").dropdown("toggle");
  });

  $('.dropdown-toggle').dropdown();

  $('.open-external-link').on('click', function(event) {
    event.stopPropagation();
  });

  $('.open-in-external-program').on('click', function(event) {
    event.preventDefault();
    event.stopPropagation();

    var open_path = $(this).attr('data-path');
    if (open_path && open_path != '') {
      $.get('/open?path=' + encodeURIComponent(open_path), function(resp) {
        // console.log(resp);
        if (resp && resp.error) {
          console.log(resp.error);
        }
      });
    }
  });

  var showNotification = function(title, message, timeout) {
    if ($('#notification-pane').hasClass('hidden')) {
      $('#notification-pane').removeClass('hidden');
    }
    $('#notification-title').text(title);
    $('#notification-message').html(message);
    setTimeout(function() {
      $('#notification-pane').addClass('hidden');
    }, timeout||3000);
  }

  $('.delete-folder').on('click', function(event) {
    event.preventDefault();
    event.stopPropagation();

    var folder_path = $(this).attr('data-path');
    if (folder_path && folder_path != '') {
      $('#deleteConfirmModal .modal-title').text('Delete folder?');
      $('#deleteConfirmModal .modal-body').text(''+decodeURIComponent(folder_path));

      $('#delete-confirmed-button').unbind('click');
      $('#delete-confirmed-button').bind('click', function(event) {
        event.preventDefault();
        $('#deleteConfirmModal').modal('toggle');
        $.post('/delete?path=' + encodeURIComponent(folder_path), function(resp) {
          // console.log(resp);
          if (resp && resp.error) {
            console.log(resp.error);
            showNotification('Folder delete failed', resp.error);
          } else if (resp.deleted) {
            showNotification('Folder deleted', decodeURIComponent(folder_path));
          }
        });
      });

      $('#deleteConfirmModal').modal('show');
    }
  });

  $('.delete-file').on('click', function(event) {
    event.preventDefault();
    event.stopPropagation();

    var file_path = $(this).attr('data-path');
    if (file_path && file_path != '') {
      $('#deleteConfirmModal .modal-title').text('Delete file?');
      $('#deleteConfirmModal .modal-body').text(''+decodeURIComponent(file_path));

      $('#delete-confirmed-button').unbind('click');
      $('#delete-confirmed-button').bind('click', function(event) {
        event.preventDefault();
        $('#deleteConfirmModal').modal('toggle');
        $.post('/delete?path=' + encodeURIComponent(file_path), function(resp) {
          // console.log(resp);
          if (resp && resp.error) {
            console.log(resp.error);
            showNotification('File delete failed', resp.error);
          } else if (resp.deleted) {
            showNotification('File deleted', decodeURIComponent(file_path));
          }
        });
      });

      $('#deleteConfirmModal').modal('show');
    }
  });

  /* File Preview */

  var current_index = -1;
  var is_previewing = false;

  var preview_items = [];

  var previewable_files_count = 0;
  var previewable_files_index_map = {};

  var file_preview_image_size = 'fit'; // 'fit', 'fit-width', 'fit-height', 'max'

  var isFolder = function($item) {
    return $item.hasClass('item-folder');
  }

  var isImageFile = function($item) {
    return $item.hasClass('item-file-jpg') || $item.hasClass('item-file-png')
        || $item.hasClass('item-file-gif') || $item.hasClass('item-file-jpeg');
  }
  var isVideoFile = function($item) {
    return $item.hasClass('item-file-mp4') || $item.hasClass('item-file-webm');
  }
  var isMP4VideoFile = function($item) {
    return $item.hasClass('item-file-mp4');
  }
  var isWebMVideoFile = function($item) {
    return $item.hasClass('item-file-webm');
  }
  var isComicFile = function($item) {
    return $item.hasClass('item-file-cbz') || $item.hasClass('item-file-cbr')
       || $item.hasClass('item-file-rar') || $item.hasClass('item-file-zip');
  }

  var setItemActive = function($item) {
    $('table#items tbody tr').removeClass('info');
    $item.addClass('info');
  }

  var getCurrentPreviewItem = function() {
    // return $('table#items tbody tr').eq(current_index);
    return preview_items[current_index];
  }

  var getNextPreviewItem = function() {

    var next_index = current_index+1;
    // console.log('Index:', current_index);

    // if (next_index >= $('table#items tbody tr').length) {
    //   return null;
    // }
    if (next_index >= preview_items.length) {
      return null;
    }

    current_index = next_index;

    // var $item = $('table#items tbody tr').eq(current_index);
    var $item = preview_items[current_index];
    if ($item) {
      if (isImageFile($item) || isVideoFile($item) || isComicFile($item)) {
        return $item;
      } else {
        return getNextPreviewItem();
      }
    } else {
      return getNextPreviewItem();
    }
  }

  var getPrevPreviewItem = function() {

    if (current_index == 0) {
      return null;
    }

    current_index = current_index-1;
    // console.log('Index:', current_index);

    // var $item = $('table#items tbody tr').eq(current_index);
    var $item = preview_items[current_index];
    if ($item) {
      if (isImageFile($item) || isVideoFile($item) || isComicFile($item)) {
        return $item;
      } else {
        return getPrevPreviewItem();
      }
    } else {
      return getPrevPreviewItem();
    }
  }

  var preloadImage = function(image_src, loaded) {
    $('<img />').on('load', loaded).each(function(){
      if (this.complete) {
        $(this).trigger('load');
      }
    }).attr("src", image_src);
  }

  var onImageLoaded = function($img, loaded) {
    $img.on('load', loaded).each(function(){
      if (this.complete) {
        $(this).trigger('load');
      }
    });
  }

  var previewImageFile = function($item) {
    var file_path = $item.attr('data-file-path');
    // console.log('Preview:', file_link);

    $('#file-preview-content').html(
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
      '<img class="fadeIn animated ' + (file_preview_image_size||'fit') + 
        '" src="/file?path=' + encodeURIComponent(file_path) + '">'
    );
    $("#previewModal").modal('show');
    
    if (file_preview_image_size == 'fit-width' || file_preview_image_size == 'max') {
      applyZoom();
      if (!$('#file-preview-actions').hasClass('hidden')) {
        showZoom();
      }
    }

    $("<img/>").on('load', function(){
      var file_info = $('#file-preview-file-info').text();
      file_info += ' - ' + this.width + 'x' + this.height;
      $('#file-preview-file-info').text(file_info);
    }).attr("src", '/file?path=' + encodeURIComponent(file_path));
  }

  var previewMP4VideoFile = function($item) {
    var file_path = $item.attr('data-file-path');
    // console.log('Preview:', file_path);

    $('#file-preview-content').html(
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
      '<video width="100%" height="95%" controls="controls" autoplay>' +
        '<source src="/video?path=' +  encodeURIComponent(file_path) + '" type="video/mp4" />' +
      '</video>'
    );
    $("#previewModal").modal('show');
  }

  var previewWebMVideoFile = function($item) {
    var file_path = $item.attr('data-file-path');
    // console.log('Preview:', file_path);

    $('#file-preview-content').html(
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
      '<video width="100%" height="95%" controls="controls" autoplay>' +
        '<source src="/video?path=' +  encodeURIComponent(file_path) + '" type="video/webm" />' +
      '</video>'
    );
    $("#previewModal").modal('show');
  }

  var previewComicFile = function($item) {
    var file_path = $item.attr('data-file-path');
    // console.log('Preview:', file_path);

    $('#file-preview-content').html(
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
      // '<span style="color: white;"><i class="fa fa-spinner fa-pulse fa-3x fa-fw"></i></span>'
    );
    
    $.getJSON('/comic?path=' + encodeURIComponent(file_path), function(data) {
      console.log(data);

      if (data && data.error) {
        console.log(data.error);
      } else if (data) {
        var pages_count = (data.pages_count);
        var file_info_text = $('#file-preview-file-info').text();

        $('#file-preview-file-info').text(file_info_text + ' - Comic (' + pages_count 
          + ' page' + ((pages_count>1)?'s)':')'));

        var preview_html = 
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>';

        // if (data.pages && data.pages.length) {
        //   preview_html += '<img src="/comic?path=' + encodeURIComponent(file_path) + 
        //     '&page=0" class="fadeIn animated ' + (file_preview_image_size||'fit') + '" alt="Page - 1">';
        // }

        $('#file-preview-content').html(preview_html);

        if (data.pages && data.pages.length) {
          var $page_image_0 = $('<img src="/comic?path=' + encodeURIComponent(file_path) + 
            '&page=0" class="fadeIn animated ' + (file_preview_image_size||'fit') + '" alt="Page - 1">');
          
          onImageLoaded($page_image_0, function() {
            $page_image_0.attr('data-width', $page_image_0.prop('naturalWidth'));
            $page_image_0.attr('data-height', $page_image_0.prop('naturalHeight'));
            if (file_preview_image_size != 'fit' && file_preview_image_size != 'fit-height') {
              applyZoom($page_image_0);
            }
          });
          
          $('#file-preview-content').append($page_image_0);
          
          if (file_preview_image_size == 'fit-width' || file_preview_image_size == 'max') {
            applyZoom($page_image_0);
          }
        }

        if (file_preview_image_size == 'fit-width' || file_preview_image_size == 'max') {
          // applyZoom();
          if (!$('#file-preview-actions').hasClass('hidden')) {
            showZoom();
          }
        }

        if (data.pages && data.pages.length>1) {

          file_info_text = $('#file-preview-file-info').text();
          var loaded_pages = 1;

          $('#file-preview-load-more-button').removeClass('hidden');

          var loadNextPage = function() {
            var $page_image = $('<img class="lazyload fadeIn animated extra ' + 
              (file_preview_image_size||'fit-width') + '"' + 
              ' src="data:image/gif;base64,R0lGODdhAQABAPAAAMPDwwAAACwAAAAAAQABAAACAkQBADs="' +
              ' data-src="/comic?path=' + encodeURIComponent(file_path) + '&page=' + loaded_pages + 
              '" alt="Page - ' + (loaded_pages+1) + '">')
              
            onImageLoaded($page_image, function() {
              $page_image.attr('data-width', $page_image.prop('naturalWidth'));
              $page_image.attr('data-height', $page_image.prop('naturalHeight'));
              if (file_preview_image_size != 'fit' && file_preview_image_size != 'fit-height') {
                applyZoom($page_image);
              }
            });

            $('#file-preview-content').append($page_image);

            loaded_pages++;

            if (file_preview_image_size == 'fit-width' || file_preview_image_size == 'max') {
              applyZoom($page_image);
            }

            if (loaded_pages >= data.pages.length) {
              // $('#file-preview-load-more-button').addClass('hidden');
              $('#file-preview-content').unbind('scroll');
            } else {
              // setTimeout(function() {
              //   if (loaded_pages < data.pages.length) {
              //     $('#file-preview-load-more-button').removeClass('hidden');
              //   }
              // },500);
            }

            // console.log('Loaded pages:', loaded_pages +'/' + data.pages.length);
            // $('#file-preview-file-info').text(file_info_text + 
            //   ' - Page ' +  loaded_pages + ' of ' + data.pages.length);

            $('#file-preview-load-more-button').html('Page ' + loaded_pages + ' of ' + data.pages.length);
          }

          loadNextPage();

          $('#file-preview-load-more-button').removeClass('hidden');
          $('#file-preview-load-more-button').unbind('click');
          $('#file-preview-load-more-button').on('click', function(event) {
            event.preventDefault();
            $('#file-preview-load-more-button').addClass('hidden');

            var max_page_index = Math.min(data.pages.length, loaded_pages+3);
            for (var i = loaded_pages; i < max_page_index; i++) {
              loadNextPage();
            }
          });

          var last_scroll_top = 0;
          $('#file-preview-content').unbind('scroll');
          $('#file-preview-content').on('scroll', function() {
            var scroll_top = $('#file-preview-content').scrollTop();
            var ele_height = $('#file-preview-content').height();
            var ele_scroll_height = $('#file-preview-content').prop("scrollHeight");
              
            // scroll down: last_scroll_top < scroll_top
            if (last_scroll_top < scroll_top && ele_scroll_height < (ele_height+scroll_top+150) 
              && loaded_pages < data.pages.length) {
              loadNextPage();
            }
          });
        } else {
          $('#file-preview-load-more-button').addClass('hidden');
        }
        
      } else {
        $('#file-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
          );
      }
    }).fail(function(data) {
      console.log(data);
      if (data.responseJSON && data.responseJSON.error) {
        $('#file-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' + 
          '<span style="display: inline-block;color: white;">' + data.responseJSON.error + '</span>'
          );
      } else {
        $('#file-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
          );
      }
    });

    $("#previewModal").modal('show');
  }

  var previewItem = function($item) {
    if ($item) {

      $('#file-preview-title').text($item.attr('data-file-name'));
      $('#file-preview-file-info').text($item.attr('data-file-type').toUpperCase() 
        + ' - ' + $item.attr('data-file-size'));

      if ($('#file-preview-title').hasClass('hidden')) {
        $('#file-preview-title').removeClass('hidden');
        setTimeout(function() {
          $('#file-preview-title').addClass('hidden');
        }, 2000);
      }

      hideZoom();

      var index = previewable_files_index_map[$item.index()];
      $('#file-preview-subtitle').text('' + (index+1) + ' of ' + previewable_files_count);

      if (isImageFile($item)) {
        previewImageFile($item);
      } else if (isMP4VideoFile($item)) {
        previewMP4VideoFile($item);
      } else if (isWebMVideoFile($item)) {
        previewWebMVideoFile($item);
      } else if (isComicFile($item)) {
        previewComicFile($item);
      }
    }
  }

  var previewNextItem = function() {
    var $item = getNextPreviewItem();
    if ($item) {
      // $('table#items tbody tr').removeClass('info');
      // $item.addClass('info');
      setItemActive($item);
      previewItem($item);
    }
  }

  var previewPrevItem = function() {
    var $item = getPrevPreviewItem();
    if ($item) {
      // $('table#items tbody tr').removeClass('info');
      // $item.addClass('info');
      setItemActive($item);
      previewItem($item);
    }
  }
  
  // Zooming

  var hideZoom = function() {
    $('#zoom-control').addClass('hidden');
  }

  var showZoom = function() {
    $('#zoom-control').removeClass('hidden');
  }

  var zoomIn = function() {
    var zoom_value = $('#zoom-value').attr('data-value');
    if (zoom_value == 'auto') {
      zoom_value = 100;
    } else {
      zoom_value = parseInt(zoom_value);
    }
    if (!isNaN(zoom_value)) {
      zoom_value += 5;
      if (file_preview_image_size == 'fit-width' && zoom_value >= 100) {
        zoom_value = 100;
        $('#zoom-control #zoom-in').addClass('disable');
      } else {
        $('#zoom-control #zoom-in').removeClass('disable');
      }
      $('#zoom-value').attr('data-value', zoom_value);
      // $('#file-preview-content img').css('width', zoom_value+'%');
      applyZoom();
    }
  }

  var zoomOut = function() {
    var zoom_value = $('#zoom-value').attr('data-value');
    if (zoom_value == 'auto') {
      zoom_value = 100;
    } else {
      zoom_value = parseInt(zoom_value);
    }
    if (!isNaN(zoom_value)) {
      zoom_value -= 5;
      if (zoom_value <= 10) {
        zoom_value = 10;
        $('#zoom-control #zoom-out').addClass('disable');
      } else {
        $('#zoom-control #zoom-out').removeClass('disable');
      }
      $('#zoom-value').attr('data-value', zoom_value);
      // $('#file-preview-content img').css('width', zoom_value+'%');
      applyZoom();
    }
  }

  var setZoom = function(width) {
    $('#zoom-value').attr('data-value', width);
  }

  var resetZoom = function() {
    $('#zoom-value').attr('data-value', 'auto');
    $('#file-preview-content img').css('width', 'auto');
  }

  var zoomImage = function($img, zoom_value) {
    var img_width = $img.attr('data-width');
    if (img_width) img_width = parseInt(img_width);
    if (file_preview_image_size != 'fit-width' && img_width && !isNaN(img_width)) {
      var css_width = ((zoom_value*img_width)/100).toFixed(0);
      $img.css('width', css_width+'px');
    } else {
      $img.css('width', zoom_value+'%');
    }
  }

  var applyZoom = function($img) {
    var zoom_value = $('#zoom-value').attr('data-value');
    if (zoom_value == 'auto') {
      if ($img) {
        $img.css('width', 'auto');
      } else {
        $('#file-preview-content img').css('width', 'auto');
      }
      return;
    }
    zoom_value = parseInt(zoom_value);
    if (!isNaN(zoom_value)) {
      // $('#file-preview-content img').css('width', zoom_value+'%');
      if ($img) {
        zoomImage($img, zoom_value);
      } else {
        $('#file-preview-content img').each(function() {
          zoomImage($(this), zoom_value);
        });
      }
    }
  }

  //

  var togglePreviewImageSize = function() {
    // 'fit' -> 'max' -> 'fit-width' -> 'fit-height' -> 'fit' -> ...
    if (file_preview_image_size == 'fit') { // 'fit' -> 'max'
      file_preview_image_size = 'max';
      $('#file-preview-image-resize-button').html('<b style="font-size: 16px;line-height: 12px;">1:1</b>');
      $('#file-preview-content img').removeClass('fit').addClass('max');
      showZoom();
      resetZoom();
      applyZoom();
    } else if (file_preview_image_size == 'max') { // 'max' -> 'fit-width'
      file_preview_image_size = 'fit-width';
      $('#file-preview-image-resize-button').html('<i class="fa fa-arrows-h fa-lg fa-fw"></i>');
      $('#file-preview-content img').removeClass('max').addClass('fit-width');
      showZoom();
      setZoom(100);
      applyZoom();
    } else if (file_preview_image_size == 'fit-width') { // 'fit-width' -> 'fit-height'
      file_preview_image_size = 'fit-height';
      $('#file-preview-image-resize-button').html('<i class="fa fa-arrows-v fa-lg fa-fw"></i>');
      $('#file-preview-content img').removeClass('fit-width').addClass('fit-height');
      hideZoom();
      resetZoom();
    } else { // 'fit-height' -> 'fit'
      file_preview_image_size = 'fit';
      $('#file-preview-image-resize-button').html('<i class="fa fa-arrows fa-lg fa-fw"></i>');
      $('#file-preview-content img').removeClass('fit-height').addClass('fit');
      hideZoom();
      resetZoom();
    }
  }

  var windowHeight = function() {
    return window.innerHeight ? window.innerHeight : $(window).height();
  }

  var closePreviewModal = function() {
    if ($('#previewModal').hasClass('in')) {
      $('#previewModal').modal('toggle');
      $('#file-preview-content').html('');
    }
  }

  $('#previewModal').on('show.bs.modal', function () {
    is_previewing = true;
    $('#previewModal .modal-body').unbind('scroll');
    // $('#previewModal .modal-body').css('overflow-y', 'auto'); 
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      $('#previewModal .modal-body').css('height', windowHeight());
    } else {
      $('#previewModal .modal-body').css('height', windowHeight() - 15);
    }
  });

  $(window).resize(function() {
    if (is_previewing) {
      if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
        $('#previewModal .modal-body').css('height', windowHeight());
      } else {
        $('#previewModal .modal-body').css('height', windowHeight() - 15);
      }
    }
  });

  $('#previewModal').on('hide.bs.modal', function () {
    is_previewing = false;
    $('#file-preview-content').html('');
  });

  $(document).on('keydown', function (event) {
    if (!is_previewing) return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    // console.log('Keydown:', event.keyCode || event.which);
    var keycode = event.keyCode || event.which;
    if (keycode == 37) { // left
      previewPrevItem();
    } else if (keycode == 39) { // right
      previewNextItem();
    } else if (keycode == 27) { // esc
      closePreviewModal();
    } else if (keycode == 83) { // 's'
      togglePreviewImageSize();
    }
  });

  $('#file-preview-content').on('click', function(event) {
    event.preventDefault();
    $('#file-preview-actions').toggleClass('hidden');
    $('#file-preview-load-more-button-container').toggleClass('hidden');
    // $('#file-preview-title').toggleClass('hidden');
    if ($('#file-preview-actions').hasClass('hidden')) {
      $('#file-preview-title').addClass('hidden');
    } else {
      $('#file-preview-title').removeClass('hidden');
    }
    if (file_preview_image_size == 'fit-width' || file_preview_image_size == 'max') {
      // $('#zoom-control').toggleClass('hidden');
      if ($('#file-preview-actions').hasClass('hidden')) {
        hideZoom();
      } else {
        showZoom();
      }
    }
  });

  $('#file-preview-right').on('click', function(event) {
    event.preventDefault();
    previewNextItem();
  });

  $('#file-preview-left').on('click', function(event) {
    event.preventDefault();
    previewPrevItem();
  });

  $('#file-preview-next').on('click', function(event) {
    event.preventDefault();
    previewNextItem();
  });

  $('#file-preview-prev').on('click', function(event) {
    event.preventDefault();
    previewPrevItem();
  });

  $('#file-preview-close a').on('click', function(event) {
    event.preventDefault();
    closePreviewModal();
  });

  $('#file-preview-close-button').on('click', function(event) {
    event.preventDefault();
    closePreviewModal();
  });

  $('#file-preview-image-resize-button').on('click', function(event) {
    event.preventDefault();
    togglePreviewImageSize();
  });

  $('table#items tbody tr td a').on('click', function(event) {
    event.stopPropagation();
  });

  $('table#items tbody tr').each(function() {
    var $item = $(this);

    if (isImageFile($item) || isVideoFile($item) || isComicFile($item)) {
      previewable_files_index_map[$item.index()] = previewable_files_count;
      previewable_files_count++;
      preview_items.push($item);
    }
  });

  $('table#items tbody tr').on('click', function(event) {
    // event.preventDefault();
    var $item = $(this);

    if (isFolder($item)) {
      event.preventDefault();

      var folder_path = $item.attr('data-path');
      window.location.href = '/files?dir=' + encodeURIComponent(folder_path);
    } else {
      event.preventDefault();
      setItemActive($item);

      current_index = $item.index();
      // console.log('Index:', $(this).index());

      previewItem($item);
    }
  });

  $('#grid-items .grid-item').each(function() {
    var $item = $(this);

    if (isImageFile($item) || isVideoFile($item) || isComicFile($item)) {
      previewable_files_index_map[$item.index()] = previewable_files_count;
      previewable_files_count++;
      preview_items.push($item);
      $item.attr('data-preview-index', preview_items.length-1);
    }
  });

  $('#grid-items .grid-item a.item-thumb').on('click', function(event) {
    // event.preventDefault();

    var $item = $(this).closest('.grid-item');
    if (isFolder($item)) {
      event.preventDefault();

      var folder_path = $item.attr('data-path');
      window.location.href = '/files?dir=' + encodeURIComponent(folder_path);
    } else if (isImageFile($item) || isVideoFile($item) || isComicFile($item)) {
      event.preventDefault();
      setItemActive($item);

      current_index = parseInt($item.attr('data-preview-index'));
      // console.log('Index:', $(this).index());

      previewItem($item);
    }
  });

  $('#zoom-control #zoom-in').on('click', function(event) {
    event.preventDefault();
    zoomIn();
  });

  $('#zoom-control #zoom-out').on('click', function(event) {
    event.preventDefault();
    zoomOut();
  });

})