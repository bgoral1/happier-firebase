const functions = require('firebase-functions');
const admin = require('firebase-admin');
const mimeTypes = require('mimetypes');
const axios = require('axios');

admin.initializeApp(functions.config().firebase);

exports.checkLogin = functions.https.onCall(async (data) => {
  dataValidator(data, {
    userName: 'string',
  });

  const publicProfile = await admin
  .firestore()
  .collection('publicProfiles')
  .doc(data.userName)
  .get();

  if (publicProfile.exists) {
    throw new functions.https.HttpsError(
      'already-exists',
      'This login is already taken'
    );
  }

  return;
});


exports.createPublicProfile = functions.https.onCall(async (data, context) => {
  checkAuthentication(context);

  const userProfile = await admin
    .firestore()
    .collection('publicProfiles')
    .where('userId', '==', context.auth.uid)
    .limit(1)
    .get();

  if (!userProfile.empty) {
    throw new functions.https.HttpsError(
      'already-exists',
      'This user already has a public profile'
    );
  }

  const user = await admin.auth().getUser(context.auth.uid);
  if (user.email === functions.config().accounts.admin) {
    await admin.auth().setCustomUserClaims(context.auth.uid, { admin: true });
  }

  return admin.firestore().collection('publicProfiles').doc(data.userName).set({
    userId: context.auth.uid,
    petsWatched: [],
  });
});

exports.addToPetsWatched = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, false, false);
  dataValidator(data, {
    petId: 'string',
    userName: 'string',
  });

  const petRef = admin.firestore().collection('pets').doc(data.petId);
  const userProfile = admin.firestore().collection('publicProfiles').doc(data.userName);

  return await userProfile.update({petsWatched: admin.firestore.FieldValue.arrayUnion(petRef)});
});

exports.removeFromPetsWatched = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, false, false);
  dataValidator(data, {
    petId: 'string',
    userName: 'string',
  });

  const petRef = admin.firestore().collection('pets').doc(data.petId);
  const userProfile = admin.firestore().collection('publicProfiles').doc(data.userName);

  return await userProfile.update({petsWatched: admin.firestore.FieldValue.arrayRemove(petRef)});
});

exports.addPet = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, false, true);
  dataValidator(data, {
    species: 'string',
    name: 'string',
    lead: 'string',
    description: 'string',
    institutionId: 'string',
    filters: 'object',
    petImage: 'string',
  });

  const mimeType = data.petImage.match(
    /data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/
  )[1];
  const base64EncodedImageString = data.petImage.replace(
    /^data:image\/\w+;base64,/,
    ''
  );
  const imageBuffer = new Buffer(base64EncodedImageString, 'base64');

  const filename = `petImages/${data.name + Math.floor(Math.random() * 1000 + 1).toString()}.${mimeTypes.detectExtension(
    mimeType
  )}`;
  const file = admin.storage().bucket().file(filename);
  await file.save(imageBuffer, { contentType: 'image/jpeg' });
  const fileUrl = await file
    .getSignedUrl({ action: 'read', expires: '03-09-2491' })
    .then((urls) => urls[0]);

  const docData = {
    species: data.species,
    name: data.name,
    lead: data.lead,
    description: data.description,
    filters: data.filters,
    imageUrl: fileUrl,
    institution: admin
      .firestore()
      .collection('institutions')
      .doc(data.institutionId),
  };

  new Promise((resolve, reject) => {
    admin
      .firestore()
      .collection('pets')
      .add(docData)
      .then(resolve)
      .then(() => {
        return axios.post('https://api.netlify.com/build_hooks/60198b0df7937c1b517b85cf');
      })
      .catch(reject);
  })
});

exports.updatePet = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, false, true);

  let fileType = 'string';

  if(data.petImage === null){
    fileType = 'object';
  }

  dataValidator(data, {
    petId: 'string',
    petDataToUpdate: 'object',
    petImage: fileType,
  });

  if(data.petImage !== null){
    const mimeType = data.petImage.match(
      /data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/
    )[1];
    const base64EncodedImageString = data.petImage.replace(
      /^data:image\/\w+;base64,/,
      ''
    );
    const imageBuffer = new Buffer(base64EncodedImageString, 'base64');

    const filename = `petImages/${data.name + Math.floor(Math.random() * 1000 + 1).toString()}.${mimeTypes.detectExtension(
      mimeType
    )}`;
    const file = admin.storage().bucket().file(filename);
    await file.save(imageBuffer, { contentType: 'image/jpeg' });
    const fileUrl = await file
      .getSignedUrl({ action: 'read', expires: '03-09-2491' })
      .then((urls) => urls[0]);
      data.petDataToUpdate.imageUrl = fileUrl;
  }

  new Promise((resolve, reject) => {
      admin
        .firestore()
        .collection('pets')
        .doc(data.petId)
        .update(data.petDataToUpdate)
        .then(resolve)
        .catch(reject);
    });
  }
);

exports.removePet = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, false, true);
  dataValidator(data, {
    petId: 'string',
  });

  const petdoc = admin.firestore().collection('pets').doc(data.petId);

  return await petdoc.delete();
});

exports.addInstitutionRole = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, true, false);
  dataValidator(data, {
    email: 'string',
  });

  const user = await admin.auth().getUserByEmail(data.email);

  return admin
    .auth()
    .setCustomUserClaims(user.uid, { institution: true })
    .catch((error) => {
      console.error('Error writing document: ', error);
    });
});

exports.addToInstitutions = functions.https.onCall(async (data, context) => {
  checkAuthentication(context, true, false);
  dataValidator(data, {
    name: 'string',
    email: 'string',
    city: 'string',
  });

  const user = await admin.auth().getUserByEmail(data.email);

  return admin
    .firestore()
    .collection('institutions')
    .doc(user.uid)
    .set({
      email: data.email,
      city: data.city.toLowerCase(),
      name: data.name.toLowerCase(),
    });
});

function checkAuthentication(context, admin, institution) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in to view this page'
    );
  } else if (!context.auth.token.admin && admin) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You must be an administrator to use this funcionality'
    );
  } else if (!context.auth.token.institution && institution) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You must be authorized by an approved institution to use this feature'
    );
  }
}

function dataValidator(data, validKeys) {
  if (Object.keys(data).length !== Object.keys(validKeys).length) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Number of arguments invalid'
    );
  } else {
    for (let key in data) {
      if (!validKeys[key] || typeof data[key] !== validKeys[key]) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Invalid arguments'
        );
      }
    }
  }
}
