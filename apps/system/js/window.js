/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

(function(window) {

  var _ = navigator.mozL10n.get;

  var ENABLE_LOG = false;

  // Use mutation observer to monitor appWindow status change
  window.AppLog = function AppLog(app) {
    // select the target node
    var target = app.frame;

    // create an observer instance
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        console.log(mutation.target.id,
                    mutation.target.className,
                    mutation.attributeName);
      });
    });

    // configuration of the observer:
    var config = { attributes: true };

    // pass in the target node, as well as the observer options
    observer.observe(target, config);
  };

  window.AppError = function AppError(app) {
    var self = this;
    this.app = app;
    this.app.frame.addEventListener('mozbrowsererror', function(evt) {
      if (evt.detail.type != 'other')
        return;

      console.warn(
        'app of [' + self.app.origin + '] got a mozbrowsererror event.');

      if (self.injected) {
        self.update();
      } else {
        self.render();
      }
      self.show();
      self.injected = true;
    });
    return this;
  };

  AppError.className = 'appError';

  AppError.prototype.hide = function() {
    this.element.classList.remove('visible');
  };

  AppError.prototype.show = function() {
    this.element.classList.add('visible');
  };

  AppError.prototype.render = function() {
    this.app.frame.insertAdjacentHTML('beforeend', this.view());
    this.closeButton =
      this.app.frame.querySelector('.' + AppError.className + ' .close');
    this.reloadButton =
      this.app.frame.querySelector('.' + AppError.className + ' .reload');
    this.titleElement =
      this.app.frame.querySelector('.' + AppError.className + ' .title');
    this.messageElement =
      this.app.frame.querySelector('.' + AppError.className + ' .message');
    this.element = this.app.frame.querySelector('.' + AppError.className);
    var self = this;
    this.closeButton.onclick = function() {
      self.app.kill();
    };

    this.reloadButton.onclick = function() {
      self.hide();
      self.app.reload();
    };
  };

  AppError.prototype.update = function() {
    this.titleElement.textContent = this.getTitle();
    this.messageElement.textContent = this.getMessage();
  };

  AppError.prototype.id = function() {
    return AppError.className + '-' + this.app.frame.id;
  };

  AppError.prototype.getTitle = function() {
    if (AirplaneMode.enabled) {
      return _('airplane-is-on');
    } else if (!navigator.onLine) {
      return _('network-connection-unavailable');
    } else {
      return _('error-title', { name: this.app.name });
    }
  };

  AppError.prototype.getMessage = function() {
    if (AirplaneMode.enabled) {
      return _('airplane-is-turned-on', { name: this.app.name });
    } else if (!navigator.onLine) {
      return _('network-error', { name: this.app.name });
    } else {
      return _('error-message', { name: this.app.name });
    }
  };

  AppError.prototype.view = function() {
    return '<div id="' + this.id() + '" class="' +
        AppError.className + ' visible" role="dialog">' +
      '<div class="modal-dialog-message-container inner">' +
        '<h3 data-l10n-id="error-title" class="title">' +
          this.getTitle() + '</h3>' +
        '<p>' +
         '<span data-l10n-id="error-message" class="message">' +
            this.getMessage() + '</span>' +
        '</p>' +
      '</div>' +
      '<menu data-items="2">' +
        '<button class="close" data-l10n-id="try-again">' +
          _('close') + '</button>' +
        '<button class="reload" data-l10n-id="try-again">' +
          _('try-again') + '</button>' +
      '</menu>' +
    '</div>';
  };

  window.AppWindow = function AppWindow(configuration) {
    for (var key in configuration) {
      this[key] = configuration[key];
    }

    // We keep the appError object here for the purpose that
    // we may need to export the error state of AppWindow instance
    // to the other module in the future.
    this.appError = new AppError(this);
    if (ENABLE_LOG)
      this.appLog = new AppLog(this);

    this.render();

    return this;
  };


  /**
   * Represent the current visibility state,
   * i.e. what is currently visible. Possible value:
   * 'frame': the actual app iframe
   * 'screenshot': the screenshot overlay,
   *               serve as a placeholder for visible but not active apps.
   * 'none': nothing is currently visible.
   */
  AppWindow.prototype._visibilityState = 'frame',

  /**
   * In order to prevent flashing of unpainted frame/screenshot overlay
   * during switching from one to another,
   * many event listener & callbacks are employed.
   *
   * 1. Switching from 'frame' to 'screenshot' state:
   *   _showScreenshotOverlay() is called
   *   get screenshot from frame
   *   when getting the screenshot,
   *   show the screenshot overlay and hide the frame
   *
   * 2. Switching from 'screenshot' to 'frame' state:
   *   _showFrame() is called
   *   register next paint listener, and set the frame to visible
   *   finally, when next painted, hide the screenshot
   *
   * 3. Switching from 'none' to 'frame' state:
   *   _showFrame() is called
   *
   * 4. Switching from 'frame' to 'none' state:
   *   _hideFrame() is called
   *
   * 5. Switching from 'none' to 'screenshot' state:
   *   get screenshot from frame
   *   when getting the screenshot, show the screenshot overlay
   *
   * 6. Switching from 'screenshot' to 'none' state:
   *   _hideScreenshotOverlay is called
   *
   */

  AppWindow.prototype.setVisible =
    function aw_setVisible(visible, screenshotIfInvisible) {
      if (visible) {
        this._visibilityState = 'frame';
        this._showFrame();
      } else {
        if (screenshotIfInvisible) {
          this._visibilityState = 'screenshot';
          this._showScreenshotOverlay();
        } else {
          this._visibilityState = 'none';
          this._hideFrame();
          this._hideScreenshotOverlay();
        }
      }
    };

  /**
   * _showFrame will check |this._visibilityState|
   * and then turn on the frame visibility.
   * So this shouldn't be invoked by others directly.
   */
  AppWindow.prototype._showFrame = function aw__showFrame() {
    if (this._visibilityState != 'frame')
      return;

    // Require a next paint event
    // to remove the screenshot overlay if it exists.
    if (this.screenshotOverlay.classList.contains('visible')) {
      this._waitForNextPaint(this._hideScreenshotOverlay.bind(this));
    }

    this.iframe.classList.remove('hidden');
    this.iframe.setVisible(true);
  };

  /**
   * _hideFrame will check |this._visibilityState|
   * and then turn off the frame visibility.
   * So this shouldn't be invoked by others directly.
   */
  AppWindow.prototype._hideFrame = function aw__hideFrame() {
    if (this._visibilityState !== 'frame') {
      this.iframe.setVisible(false);
      this.iframe.classList.add('hidden');
    }
  };

  AppWindow.prototype.reload = function aw_reload() {
    this.iframe.reload(true);
  };

  AppWindow.prototype.kill = function aw_kill() {
    if (this._screenshotURL) {
      URL.revokeObjectURL(this._screenshotURL);
    }
    // XXX: A workaround because a AppWindow instance shouldn't
    // reference Window Manager directly here.
    // In the future we should make every app maintain and execute the events
    // in itself like resize, setVisibility...
    // And Window Manager is in charge of cross app management.
    WindowManager.kill(this.origin);
  };

  AppWindow.prototype.render = function aw_render() {
    var screenshotOverlay = document.createElement('div');
    screenshotOverlay.classList.add('screenshot-overlay');
    this.frame.appendChild(screenshotOverlay);
    this.screenshotOverlay = screenshotOverlay;
  };

  /**
   * A temp variable to store current screenshot object URL.
   */
  AppWindow.prototype._screenshotURL = undefined;

  /**
   * A static timeout to make sure
   * the next event don't happen too late.
   * (The same as WindowManager: kTransitionTimeout)
   */
  AppWindow.prototype.NEXTPAINT_TIMEOUT = 1000;

  AppWindow.prototype.debug = function aw_debug(msg) {
    console.log('[appWindow][' + this.origin + ']' +
                '[' + new Date().getTime() / 1000 + ']' + msg);
  };

  /**
   * Wait for a next paint event from mozbrowser iframe,
   * The callback would be called in this.NEXTPAINT_TIMEOUT ms
   * if the next paint event doesn't happen.
   * The use case is for the moment just before we turn on
   * the iframe visibility, so the TIMEOUT isn't too long.
   * @param  {Function} callback The callback function to be invoked
   *                             after we get next paint event.
   */
  AppWindow.prototype._waitForNextPaint =
    function aw__waitForNextPaint(callback) {
      if (!callback)
        return;

      var nextPaintTimer;
      var iframe = this.iframe;
      var onNextPaint = function aw_onNextPaint() {
        iframe.removeNextPaintListener(onNextPaint);
        clearTimeout(nextPaintTimer);

        callback();
      };

      nextPaintTimer = setTimeout(function ifNextPaintIsTooLate() {
        iframe.removeNextPaintListener(onNextPaint);

        callback();
      }, this.NEXTPAINT_TIMEOUT);

      iframe.addNextPaintListener(onNextPaint);
    };

  /**
   * Currently this happens to active app window when:
   * Attentionscreen shows no matter it's fresh newly created
   * or slide down from active-statusbar mode.
   */
  AppWindow.prototype._showScreenshotOverlay =
    function aw__showScreenshotOverlay() {
      if (this._nextPaintTimer) {
        clearTimeout(this._nextPaintTimer);
        this._nextPaintTimer = null;
      }

      this.getScreenshot(function onGettingScreenshot(screenshot) {
        // If the callback is too late,
        // and we're brought to foreground by somebody.
        if (this._visibilityState == 'frame')
          return;

        if (!screenshot) {
          // If no screenshot,
          // still hide the frame.
          this._hideFrame();
          return;
        }

        this._screenshotURL = URL.createObjectURL(screenshot);
        this.screenshotOverlay.style.backgroundImage =
          'url(' + this._screenshotURL + ')';
        this.screenshotOverlay.classList.add('visible');

        if (!this.iframe.classList.contains('hidden'))
          this._hideFrame();

        // XXX: we ought not to change screenshots at Window Manager
        // here. In the long run Window Manager should replace
        // its screenshots variable with appWindow._screenshotURL.
        if (WindowManager.screenshots[this.origin]) {
          URL.revokeObjectURL(WindowManager.screenshots[this.origin]);
        }
        WindowManager.screenshots[this.origin] = this._screenshotURL;
      }.bind(this));
    };

  /**
   * Check if current visibility state is screenshot or not,
   * to hide the screenshot overlay.
   */
  AppWindow.prototype._hideScreenshotOverlay =
    function aw__hideScreenshotOverlay() {
      if (this._visibilityState != 'screenshot' &&
          this.screenshotOverlay.classList.contains('visible'))
        this.screenshotOverlay.classList.remove('visible');
    };

  /**
   * get the screenshot of mozbrowser iframe.
   * @param  {Function} callback The callback function to be invoked
   *                             after we get the screenshot.
   */
  AppWindow.prototype.getScreenshot = function aw_getScreenshot(callback) {
    // XXX: We had better store offsetWidth/offsetHeight.

    // We don't need the screenshot of homescreen because:
    // 1. Homescreen background is transparent,
    //    currently gecko only sends JPG to us.
    //    See bug 878003.
    // 2. Homescreen screenshot isn't required by card view.
    //    Since getScreenshot takes additional memory usage,
    //    let's early return here.

    // XXX: Determine |this.isHomescreen| or not on our own in
    // appWindow.
    if (this.isHomescreen) {
      callback();
      return;
    }

    var req = this.iframe.getScreenshot(
      this.iframe.offsetWidth, this.iframe.offsetHeight);

    req.onsuccess = function gotScreenshotFromFrame(evt) {
      var result = evt.target.result;
      callback(result);
    };

    req.onerror = function gotScreenshotFromFrameError(evt) {
      callback();
    };
  };

}(this));
