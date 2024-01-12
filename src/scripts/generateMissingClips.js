require('../modules/env');
const { Database } = require('../modules/database');
const { Runtime } = require('../modules/runtime');
let index = 0;
let voiceIndex = 0;
let sentences = [];
let failedTimeout = null;

function next(success, id, filepath) {
  clearTimeout(failedTimeout);
  if (success) {
    console.log('save', id, filepath, sentences[index]._id);
    save(index, voiceIndex, filepath);
  } else {
    console.log('failed', id, filepath, sentences[index]._id);
    doNext();
  }
}

function failure() {
  console.log('failure (timeout)!');
  doNext();
}

async function save(ind, voiceInd, filepath) {
  sentences[ind][`clip${sentences[ind].voice[voiceInd]}`] = filepath;
  await Database.replaceOne('sentence', { _id: sentences[ind]._id }, sentences[ind]);
  doNext();
}

async function doNext() {
  voiceIndex++;
  if (voiceIndex >= sentences[index].voice.length) {
    voiceIndex = 0;
    index++;
    if (index >= sentences.length) {
      console.log('all done!');
      process.exit(0);
    }
  }
  generate();
}

async function main() {
  Runtime.setNext(next);
  let someSentences = await Database.find('sentence', {
    $and: [{ clipw: null }, { clipn: null }, { clipi: null }, { clipe: null }, { pause: null }],
  });
  for (let i = 0; i < someSentences.length; i++) {
    if (someSentences[i].text && /\w_\w+_\w,/.test(someSentences[i].text) === false) {
      sentences.push(someSentences[i]);
    }
  }
  generate();
}

async function generate() {
  if (
    sentences[index][`clip${sentences[index].voice[voiceIndex]}`] === null &&
    sentences[index][`clip${sentences[index].voice[voiceIndex]}try`] < 1000 &&
    sentences[index].text
  ) {
    console.log(`generate ${sentences[index]._id} / ${voiceIndex}...`);
    failedTimeout = setTimeout(failure, 5 * 60 * 1000);
    sentences[index][`clip${sentences[index].voice[voiceIndex]}try`]++;
    await Database.replaceOne('sentence', { _id: sentences[index]._id }, sentences[index]);
    const done = await Runtime.generate(sentences[index], voiceIndex);
  } else {
    if (!sentences[index].text) {
      console.log(`skip ${sentences[index]._id} / ${voiceIndex} (no text).`);
    } else if (sentences[index][`clip${sentences[index].voice[voiceIndex]}try`] >= 100) {
      console.log(`failed ${sentences[index]._id} / ${voiceIndex}.`);
    } else {
      console.log(`skip ${sentences[index]._id} / ${voiceIndex} (done).`);
    }
    doNext();
  }
}

main();
