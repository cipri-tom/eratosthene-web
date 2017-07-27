/** This module depends on Timeline from VisJS. But since that is not implemented as es6 module, we cannot import it */
/* global vis */

const timelineOptions = {
  width: '100%',
  height: '80px',
  moment: date => vis.moment(date).utc(),
  snap: null,
  editable: false,
  showCurrentTime: false,
  /* in case we decide to use `items` instead of `customTime`
  tooltip: { followMouse: true, overflowMethod: 'flip' },
  tooltipOnItemUpdateTime: true, */
  moveable: true,
  zoomable: true,
  zoomKey: 'ctrlKey',
  horizontalScroll: true,
  verticalScroll: false,
  zoomMin: 1000, // 1 second
  // zoomMax: 1000 * 3600 * 24 * 365 * 100, // 100 years
};

const MODES_TEXT = ['_INITIALISED_', '< ONLY', 'ONLY >', '< OR >', '< AND >', '< XOR >'];

const DEFAULT_TIMES = [950486422 * 1000, 1];  // 1 instead of 0 due to bug in Timeline

export default function Times(container, initialMode = 0) {
  this.callback = () => {};       // needs to be set by user

  this.container = container;
  this.timeline = new vis.Timeline(container.querySelector('#timeline'), [], timelineOptions);
  this.timeline.addCustomTime(DEFAULT_TIMES[0], 'time-1');
  this.timeline.addCustomTime(DEFAULT_TIMES[1], 'time-2');
  this.timeline.moveTo(DEFAULT_TIMES[0]);

  this.timeBar1 = this.timeline.customTimes[0].bar;
  this.timeBar2 = this.timeline.customTimes[1].bar;

  this.modesTxt = container.querySelector('#mode');
  this.timeTxt1 = container.querySelector('#time-1');
  this.timeTxt2 = container.querySelector('#time-2');

  this.timeTxt1.textContent = new Date(DEFAULT_TIMES[0]).toISOString();
  this.timeTxt2.textContent = new Date(DEFAULT_TIMES[1]).toISOString();
  this.modesTxt.textContent = MODES_TEXT[0];

  // setup callback to update display
  this.updateTime = (args) => {
    if (args.id === 'time-1') {
      this.timeTxt1.textContent = args.time.toISOString();
    } else if (args.id === 'time-2') {
      this.timeTxt2.textContent = args.time.toISOString();
    } else throw new Error('Invalid ID when updating time.');
  };
  this.timeline.on('timechange', this.updateTime);
  this.timeline.on('timechanged', () => { this.callback(); });

  this.displayTime = (eventOrString) => {
    const m = vis.moment(eventOrString instanceof Event ? event.target.innerText : eventOrString);
    this.timeline.moveTo(m.valueOf());
    this.timeline.setWindow(m.clone().subtract(1, 'w'), m.clone().add(1, 'w'));
  };
  this.timeTxt1.addEventListener('click', this.displayTime);
  this.timeTxt2.addEventListener('click', this.displayTime);

  this.toggleMode = () => { this.setMode((this.mode % 5) + 1); };
  this.modesTxt.addEventListener('click', this.toggleMode);

  // setup scroll on lower panel
  const timelineCenterPanel = container.querySelector('.vis-panel.vis-center');
  container.querySelector('.vis-panel.vis-bottom').addEventListener('wheel', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    const newEvent = new WheelEvent(ev.type, ev);
    timelineCenterPanel.dispatchEvent(newEvent);
  });

  // methods
  this.setMode = (mode) => {
    if (mode === this.mode) return;

    this.mode = mode;
    this.modesTxt.textContent = MODES_TEXT[mode];
    switch (mode) {
      case 1:
        this.displayTime(this.timeTxt1.innerText);
        this.timeTxt1.classList.remove('inactive');
        this.timeBar1.classList.remove('inactive');
        this.timeTxt2.classList.add('inactive');
        this.timeBar2.classList.add('inactive');
        break;
      case 2:
        this.displayTime(this.timeTxt2.innerText);
        this.timeTxt2.classList.remove('inactive');
        this.timeBar2.classList.remove('inactive');
        this.timeTxt1.classList.add('inactive');
        this.timeBar1.classList.add('inactive');
        break;
      case 3: case 4: case 5:
        const m1 = vis.moment(this.timeTxt1.innerText);
        const m2 = vis.moment(this.timeTxt2.innerText);
        if (m1.isBefore(m2)) this.timeline.setWindow(m1.subtract(1, 'w').valueOf(), m2.add(1, 'w').valueOf());
        else                 this.timeline.setWindow(m2.subtract(1, 'w').valueOf(), m1.add(1, 'w').valueOf());
        this.container.querySelectorAll('.inactive').forEach((item) => { item.classList.remove('inactive'); });
        break;
      default: throw new Error('Invalid mode for times');
    }
    this.callback();
  };
  this.setMode(initialMode);

  this.getTimes = () => [this.timeline.getCustomTime('time-1').getTime() / 1000,
                         this.timeline.getCustomTime('time-2').getTime() / 1000]; // eslint-disable-line indent
}
