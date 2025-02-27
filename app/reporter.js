const util = require('./util');
const path = require('path');
const _isString = util._isString;

/** Function: defaultPathBuilder
 * This function builds paths for a screenshot file. It is appended to the
 * constructors base directory and gets prependend with `.png` or `.json` when
 * storing a screenshot or JSON meta data file.
 *
 * Parameters:
 *     (Object) spec - The spec currently reported
 *     (Array) descriptions - The specs and their parent suites descriptions
 *     (Object) result - The result object of the current test spec.
 *     (Object) capabilities - WebDrivers capabilities object containing
 *                             in-depth information about the Selenium node
 *                             which executed the test case.
 *
 * Returns:
 *     (String) containing the built path
 */
function defaultPathBuilder(spec, descriptions, results, capabilities) {
    return util.generateGuid();
}

function jasmine2MetaDataBuilder(spec, descriptions, results, capabilities) {

    let isPassed = results.status === 'passed';
    let isPending = ['pending', 'disabled', 'excluded'].includes(results.status);
    let osInfo= capabilities.get("platform") || capabilities.get("platformName");
    let version =  capabilities.get("browserVersion") || capabilities.get("version");
    let metaData = {
        description: descriptions.join(' '),
        passed: isPassed,
        pending: isPending,
        os: osInfo,
        sessionId: capabilities.get('webdriver.remote.sessionid'),
        instanceId: process.pid,
        browser: {
            name: capabilities.get('browserName'),
            version: version
        }
    };

    if (isPassed) {
        metaData.message = (results.passedExpectations[0] || {}).message || 'Passed';
        metaData.trace = (results.passedExpectations[0] || {}).stack;
    } else if (isPending) {
        metaData.message = results.pendingReason || 'Pending';
    } else {

        if (results.failedExpectations[0].message) {
            metaData.message = results.failedExpectations.map(result => result.message);
        } else {
            metaData.message = 'Failed';
        }

        if (results.failedExpectations[0].stack) {
            metaData.trace = results.failedExpectations.map(result => result.stack);
        } else {
            metaData.trace = 'No Stack trace information';
        }
    }

    return metaData;
}


function sortFunction(a, b) {
    if (a.sessionId < b.sessionId) return -1;
    else if (a.sessionId > b.sessionId) return 1;

    if (a.timestamp < b.timestamp) return -1;
    else if (a.timestamp > b.timestamp) return 1;

    return 0;
}


/** Class: ScreenshotReporter
 * Creates a new screenshot reporter using the given `options` object.
 *
 * For more information, please look at the README.md file.
 *
 * Parameters:
 *     (Object) options - Object with options as described below.
 *
 * Possible options:
 *     (String) baseDirectory - The path to the directory where screenshots are
 *                              stored. If not existing, it gets created.
 *                              Mandatory.
 *     (Function) pathBuilder - A function which returns a path for a screenshot
 *                              to be stored. Optional.
 *     (Function) jasmine2MetaDataBuilder - Function which returns an object literal
 *                                  containing meta data to store along with
 *                                  the screenshot. Optional.
 *     (Boolean) takeScreenShotsForSkippedSpecs - Do you want to capture a
 *                                                screenshot for a skipped spec?
 *                                                Optional (default: false).
 */
function ScreenshotReporter(options) {
    options = options || {};
    if (!options.baseDirectory || options.baseDirectory.length === 0) {
        throw new Error('Please pass a valid base directory to store the ' +
            'screenshots into.');
    } else {
        this.baseDirectory = options.baseDirectory;
    }

    if (typeof (options.cssOverrideFile) !== 'undefined' && _isString(options.cssOverrideFile)) {
        this.cssOverrideFile = options.cssOverrideFile;
    } else {
        this.cssOverrideFile = null;
    }

    if (typeof (options.screenshotsSubfolder) !== 'undefined' && _isString(options.screenshotsSubfolder)) {
        this.screenshotsSubfolder = options.screenshotsSubfolder;
    } else {
        this.screenshotsSubfolder = '';
    }

    if (typeof (options.jsonsSubfolder) !== 'undefined' && _isString(options.jsonsSubfolder)) {
        this.jsonsSubfolder = options.jsonsSubfolder;
    } else {
        this.jsonsSubfolder = '';
    }

    this.pathBuilder = options.pathBuilder || defaultPathBuilder;
    this.docTitle = options.docTitle || 'Test Results';
    this.docName = options.docName || 'report.html';
    this.jasmine2MetaDataBuilder = options.jasmine2MetaDataBuilder || jasmine2MetaDataBuilder;
    this.sortFunction = options.sortFunction || sortFunction;
    this.preserveDirectory = typeof options.preserveDirectory !== 'undefined' ? options.preserveDirectory : true;
    this.excludeSkippedSpecs = options.excludeSkippedSpecs || false;
    this.takeScreenShotsForSkippedSpecs =
        options.takeScreenShotsForSkippedSpecs || false;
    this.gatherBrowserLogs = options.serverSideTests ? false :
        (options.gatherBrowserLogs || true);
    this.takeScreenShotsOnlyForFailedSpecs =
        options.takeScreenShotsOnlyForFailedSpecs || false;
    this.disableScreenshots = options.serverSideTests || options.disableScreenshots || false;
    this.clientDefaults = options.clientDefaults || {};
    if (options.searchSettings) { //settings in earlier "format" there?
        this.clientDefaults.searchSettings = options.searchSettings;
    }
    if (options.columnSettings) {
        this.clientDefaults.columnSettings = options.columnSettings;
    }
    this.customCssInline = options.customCssInline;

    this.finalOptions = {
        excludeSkippedSpecs: this.excludeSkippedSpecs,
        takeScreenShotsOnlyForFailedSpecs: this.takeScreenShotsOnlyForFailedSpecs,
        takeScreenShotsForSkippedSpecs: this.takeScreenShotsForSkippedSpecs,
        disableScreenshots: this.disableScreenshots,
        pathBuilder: this.pathBuilder,
        sortFunction: this.sortFunction,
        baseDirectory: this.baseDirectory,
        screenshotsSubfolder: this.screenshotsSubfolder,
        docTitle: this.docTitle,
        docName: this.docName,
        cssOverrideFile: this.cssOverrideFile,
        prepareAssets: true,
        clientDefaults: this.clientDefaults,
        customCssInline: this.customCssInline
    };
    if (!this.preserveDirectory) {
        util.removeDirectory(this.finalOptions.baseDirectory);
    }
}

class Jasmine2Reporter {

    constructor({screenshotReporter}) {

        /* `_asyncFlow` is a promise.
         * It is a "flow" that we create in `specDone`.
         * `suiteDone`, `suiteStarted` and `specStarted` will then add their steps to the flow and the `_awaitAsyncFlow`
         * function will wait for the flow to finish before running the next spec. */
        this._asyncFlow = null;

        this._screenshotReporter = screenshotReporter;
        this._suiteNames = [];
        this._times = [];

    }

    jasmineStarted() {

        /* Register `beforeEach` that will wait for all tasks in flow to be finished. */
        beforeEach(() => this._awaitAsyncFlow());
        afterAll(() => this._awaitAsyncFlow());

    }

    suiteStarted(result) {
        this._addTaskToFlow(async () => this._suiteNames.push(result.description));
    }

    suiteDone(result) {
        this._addTaskToFlow(async () => this._suiteNames.pop());
    }

    specStarted(result) {
        this._addTaskToFlow(async () => this._times.push(nowString()));
    }

    specDone(result) {
        this._addTaskToFlow(async () => this._asyncSpecDone(result, this._times.pop()));
    }

    _addTaskToFlow(callback) {

        /* Create. */
        if (this._asyncFlow == null) {
            this._asyncFlow = callback();
        }
        /* Chain. */
        else {
            this._asyncFlow = this._asyncFlow.then(callback);
        }

    }

    /* @hack: `_awaitAsyncFlow` waits for `specDone` task to finish before running the next spec.*/
    async _awaitAsyncFlow() {
        await this._asyncFlow;
        this._asyncFlow = null;
    }

    async _asyncSpecDone(result, start) {
        // Don't report if it's skipped and we don't need it
        if (['pending', 'disabled', 'excluded'].includes(result.status) && this._screenshotReporter.excludeSkippedSpecs) {
            return;
        }
        result.started = start;
        result.stopped = nowString();

        await this._gatherBrowserLogs(result);
        await this._takeScreenShotAndAddMetaData(result);

    }

    async _gatherBrowserLogs(result) {

        if (!this._screenshotReporter.gatherBrowserLogs) {
            return;
        }

        const capabilities = await browser.getCapabilities();
        const browserName = capabilities.get('browserName');

        /* Skip incompatible browsers. */
        if (browserName == null || !browserName.toLowerCase().match(/chrome/)) {
            return;
        }

        result.browserLogs = await browser.manage().logs().get('browser');

    }

    async _takeScreenShotAndAddMetaData(result) {

        let capabilities = {
          get() { return ''; }
        };
        if (!this._screenshotReporter.disableScreenshots) {
            capabilities = await browser.getCapabilities();
        }
        let suite = this._buildSuite();

        let descriptions = util.gatherDescriptions(
            suite,
            [result.description]
        );

        let baseName = this._screenshotReporter.pathBuilder(
            null,
            descriptions,
            result,
            capabilities
        );

        let metaData = this._screenshotReporter.jasmine2MetaDataBuilder(
            null,
            descriptions,
            result,
            capabilities
        );

        let screenShotFileName = path.basename(baseName + '.png');
        let screenShotFilePath = path.join(path.dirname(baseName + '.png'), this._screenshotReporter.screenshotsSubfolder);

        let metaFile = baseName + '.json';
        let screenShotPath = path.join(this._screenshotReporter.baseDirectory, screenShotFilePath, screenShotFileName);
        let metaDataPath = path.join(this._screenshotReporter.baseDirectory, metaFile);
        let jsonPartsPath = path.join(this._screenshotReporter.baseDirectory, path.dirname(metaFile), this._screenshotReporter.jsonsSubfolder, path.basename(metaFile));

        metaData.browserLogs = [];

        let considerScreenshot = !this._screenshotReporter.disableScreenshots && !(this._screenshotReporter.takeScreenShotsOnlyForFailedSpecs && result.status === 'passed')

        if (considerScreenshot) {
            metaData.screenShotFile = path.join(this._screenshotReporter.screenshotsSubfolder, screenShotFileName);
        }

        if (result.browserLogs) {
            metaData.browserLogs = result.browserLogs
        }

        metaData.timestamp = new Date(result.started).getTime();
        metaData.duration = new Date(result.stopped) - new Date(result.started);

        let testWasExecuted = ! (['pending','disabled','excluded'].includes(result.status));
        if (testWasExecuted && considerScreenshot) {
            try {
                const png = await browser.takeScreenshot();
                util.storeScreenShot(png, screenShotPath);
            }
            catch(ex) {
                if(ex['name'] === 'NoSuchWindowError') {
                    console.warn('Protractor-beautiful-reporter could not take the screenshot because target window is already closed');
                }else {
                    console.error(ex);
                    console.error('Protractor-beautiful-reporter could not take the screenshot');
                }
                metaData.screenShotFile = void 0;
            }
        }

        util.storeMetaData(metaData, jsonPartsPath, descriptions);
        util.addMetaData(metaData, metaDataPath, this._screenshotReporter.finalOptions);
        this._screenshotReporter.finalOptions.prepareAssets = false; // signal to utils not to write all files again

    }

    // Enabling backwards-compat.  Construct Jasmine v1 style spec.suite.
    _buildSuite() {

        const buildSuite = (suiteNames, i) => {
            if (i < 0) {
                return null;
            }
            return {
                description: suiteNames[i],
                parentSuite: buildSuite(suiteNames, i - 1)
            };
        };

        return buildSuite(this._suiteNames, this._suiteNames.length);

    }

}

/**
 * Returns a reporter that complies with the new Jasmine 2.x custom_reporter.js spec:
 * http://jasmine.github.io/2.1/custom_reporter.html
 */
ScreenshotReporter.prototype.getJasmine2Reporter = function () {

    return new Jasmine2Reporter({screenshotReporter: this});

};


/** Function: reportSpecResults
 * Backward compatibility
 * Jasmine 1 is no longer supported
 */
ScreenshotReporter.prototype.reportSpecResults =
    function reportSpecResults(spec) {
        throw new Error('Jasmine 1 is no longer supported. Please upgrade to Jasmine2.')
    };

function nowString() {
    return (new Date()).toISOString();
}

module.exports = ScreenshotReporter;
