const settings = {};

let nextDestination = 'p';
let playList = [];
let isPlaying = false;
let history = [];
let lastPlayedSound = null;

let producerInterval = null;
let consumerInterval = null;

let socket;
let fakeSensorTimeout;
let ignoreSensor = true;

function reset() {
  $('#status').text('RESETTING');
  clearInterval(producerInterval);
  clearTimeout(consumerInterval);
  clearTimeout(fakeSensorTimeout);
  Howler.unload();
  nextDestination = 'p';
  playList = [];
  isPlaying = false;
  history = [];
  lastPlayedSound = null;

  brownNoise();
}

let failureCount = 0;

addEventListener('error', (e) => {
  console.error(e);
  failureCount++;
  if (failureCount > 4) {
    setTimeout(() => {
      restart();
    }, 1000);
    failureCount = 0;
  }
});

$(document).ready(() => {
  $('#status').text('INIT');

  // Refresh #sincelast and #timeout every second
  setInterval(() => {
    $('#timeout').text('...');
    const now = new Date();
    if (lastPlayedSound !== null) {
      $('#sincelast').text(
          `Current sound since ${((now.getTime() - lastPlayedSound.getTime()) / 1000).toFixed(0)} s.`,
      );
    } else {
      $('#sincelast').text('...');
    }
    let playlistString = "";
    for (const sentence of playList) {
      playlistString += `<li>${sentence._id}</li>`;
    }
    $('#playlist').html(playlistString);
  }, 1000);

  // Fetch settings
  $.post('/settings')
      .done(function (res) {
        console.clear();
        if (res.done && res.settings) {
          for (let key in res.settings) {
            settings[key] = res.settings[key];
            if (typeof settings[key] === 'string') {
              if (settings[key] === 'true' || settings[key] === 'false') {
                settings[key] = settings[key] === 'true';
              } else if (/^-?\d+\.\d+$/.test(settings[key])) {
                settings[key] = parseFloat(settings[key]);
              } else if (/^-?\d+$/.test(settings[key])) {
                settings[key] = parseInt(settings[key]);
              }
            }
            console.log(`Setting: ${key}: ${settings[key]}.`);
          }

          socket = io();
          $('#whisperVolume').val(settings.whisperVolume);
          $('#whisperVolume').on('change', () => {
            let newVal = parseFloat($('#whisperVolume').val());
            if (isNaN(newVal)) {
              $('#whisperVolume').val(settings.whisperVolume);
            } else {
              settings.whisperVolume = newVal;
              $.post('/settings', {
                newSettings: settings,
              })
                  .done(function () {})
                  .fail(function (e) {
                    console.error(e);
                  });
            }
          });
          $('#motion').on('click', () => {
            motionStart(true);
          });
          socket.on('motion-start', () => {
            $('#sensor').removeClass('btn-danger').addClass('btn-success');
            $('#sensor').text('Sensor ON');
            motionStart(false);
          });
          socket.on('motion-end', () => {
            $('#sensor').removeClass('btn-danger').addClass('btn-success');
            $('#sensor').text('Sensor ON');
            motionEnd();
          });
          socket.on('no-sensor', () => {
            $('#sensor').removeClass('btn-success').addClass('btn-danger');
            $('#sensor').text('Sensor OFF');
          });
          setTimeout(() => {
            $('#sensor-ignored').removeClass('btn-warning').addClass('btn-info').text('Sensor Active');
            ignoreSensor = false;
          }, settings.ignoreSensorDelay * 1000);
          $('#status').text('WAITING');

          // START
          setTimeout(() => {
            restart();
          }, settings.startDelay * 1000);

        } else {
          console.error('NO SETTINGS');
        }
      })
      .fail(function (e) {
        console.error(e);
      });
});

// Continuously plays an almost inaudible "brown noise" in order to prevent
// the Bluetooth speaker to turn itself off automatically after a while:
function brownNoise() {
  new Howl({
    src: [`/brownNoise.mp3`],
    preload: true,
    autoplay: true,
    loop: true,
    volume: 0.01,
  });
}

function restart() {
  reset();
  producerInterval = setInterval(async () => {
    await fetchNewSounds();
  }, 1000);
  consumerInterval = setInterval(async () => {
    playNextSound();
  }, 1000);
}

/**
 * Playlist producer
 */
async function fetchNewSounds() {
  if (playList.length < 2) {
    switch (nextDestination) {
      case 'p':
        await fetchPublic();
        nextDestination = 'i';
        break;
      case 'i':
        await fetchInterior();
        nextDestination = 'p';
    }
  }
}

const PUBLIC_SUBJECTS = ['identite', 'pythie', 'politique', 'ia', 'langue'];
const PUBLIC_TYPES = ['lent', 'rapide', 'repetitif-lent', 'repetitif-rapide', 'begue', 'court', 'jesuis', 'mavoix'];

async function fetchPublic() {
  const query = {
    destination: 'p',
    voice: 'n',
    subject: 'capital',
    type: 'transition'
  };

  const sentence = await pickOne(query);
  playList.push(sentence);
}

async function fetchInterior() {
  const query = {
    destination: 'i',
    voice: 'n',
    subject: 'djeune',
    type: 'transition'
  };

  const sentence = await pickOne(query);
  playList.push(sentence);
}

async function pickOne(query) {
  console.log('PickOne', JSON.stringify(query));
  try {
    const res = await $.post('/pick-one', { query: query, history: history }).promise();
    if (res.done && res.sentence)
      return res.sentence;
    else {
      console.log("Unexpected response");
      console.log(res);
      return null;
    }
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Playlist consumer
 */
// Executed at intervals
function playNextSound() {
  if (playList.length === 0) {
    console.log('Playlist currently empty, waiting...');
    return;
  }
  if (!isPlaying) {
    const sentence = playList.shift();
    playSound(sentence);
  }
}

function playSound(sentence) {
  if (!sentence) {
    console.log("Warning : no sentence provided");
    return;
  }
  if (isPlaying)
    return; // Already playing another sound
  isPlaying = true;
  console.log("Playing")
  console.log(sentence)

  $('#status').text(sentence.destination === 'p' ? 'PUBLIC VOICE' : 'INTERIOR VOICE');
  const sound = loadSound(sentence.clip, sentence.voice === 'w');
  sound.play();
  sound.on('end', () => {
    isPlaying = false;
    console.log("Finished playing sound ");
    console.log(sound);
    playNextSound();
    sound.unload();
  });
  lastPlayedSound = new Date();
}

function loadSound(filename, isWhisper) {
  // console.log('Load sound', filename, isWhisper);
  const sound = new Howl({
    src: [`/runtime/${filename}`],
    preload: true,
    volume: isWhisper ? settings.whisperVolume : 1,
    autoplay: false,
    loop: false,
  });
  return sound;
}

/**
 *
 * Sensor management
 */
function motionStart(fake) {
  clearTimeout(fakeSensorTimeout);
  if (fake || ignoreSensor === false) {
    $('#someone').removeClass('btn-secondary').addClass('btn-success');
    $('#someone').text('Présence');
    if (fake === true) {
      fakeSensorTimeout = setTimeout(() => {
        motionEnd(true);
      }, 3 * 1000);
    }
  } else {
    if (fake === true) {
      fakeSensorTimeout = setTimeout(() => {
        motionEnd(true);
      }, 3 * 1000);
    } else {
      console.log('(Ignore motion)');
    }
  }
}

function motionEnd() {
  clearTimeout(fakeSensorTimeout);
  if (!ignoreSensor) {
    $('#someone').removeClass('btn-success').addClass('btn-secondary');
    $('#someone').text('Absence');
  } else {
    console.log('(Ignore absence)');
  }
}