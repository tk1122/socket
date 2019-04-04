const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const ip = require("ip");
const admin = require("firebase-admin");

const serviceAccount = require("./firebase-key.json");

const app = express();
const server = new http.Server(app);
const io = socketio(server);
const PORT = 3484;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://doan-2953a.firebaseio.com"
});
server.listen(PORT);
console.log(`Server is running at: ${ip.address()}:${PORT}`);

const membersRef = admin.firestore().collection("members");
const guestsRef = admin.firestore().collection("guests");

const addGuest = async rfid => {
  return guestsRef.add({
    RFID: rfid,
    isCurrentlyIn: true,
    lastActivity: admin.firestore.Timestamp.fromDate(new Date())
  });
};

const removeGuest = async databaseId => {
  return guestsRef.doc(databaseId).delete();
};

const findMemberByRFID = async rfid => {
  return membersRef.where("RFID", "==", rfid).get();
};

const findGuestByRFID = async rfid => {
  return guestsRef.where("RFID", "==", rfid).get();
};

io.on("connection", async socket => {
  console.log("Socket client connected");

  socket = await socket.on("enterRequest", async req => {
    // Mặc định không mở cổng vào
    let shouldOpen = 0;
    let memberSnapshot = await findMemberByRFID(req);

    if (memberSnapshot.empty) {
      let guestSnapshot = await findGuestByRFID(req);

      if (guestSnapshot.empty) {
        // Trường hợp mở cổng vào 1: Khách chưa vào
        shouldOpen = 1;
        await addGuest(req);
      }
    } else {
      if (!memberSnapshot.docs[0].data().isCurrentlyIn) {
        // Trường hợp mở cổng vào 2: Thành viên đang ngoài bãi
        shouldOpen = 1;
        await membersRef.doc(memberSnapshot.docs[0].id).update({
          isCurrentlyIn: true,
          lastActivity: admin.firestore.Timestamp.fromDate(new Date())
        });
      }
    }
    // những trường hợp không mở cổng vào:
    // 1. Khách vào rồi dùng thẻ vào tiếp
    // 2. Thành viên đang trong bãi
    await socket.emit("enterResponse", shouldOpen);
  });

  socket = await socket.on("exitRequest", async req => {
    // Mặc định không mở cổng ra
    let shouldOpen = 0;
    const memberSnapshot = await findMemberByRFID(req);

    if (memberSnapshot.empty) {
      const guestSnapshot = await findGuestByRFID(req);

      if (!guestSnapshot.empty) {
        // Trường hợp mở cổng ra 1: Khách đã vào
        // Ra xong xóa khách
        shouldOpen = 1;
        await removeGuest(guestSnapshot.docs[0].id);
      }
    } else {
      if (memberSnapshot.docs[0].data().isCurrentlyIn) {
        // Trường hợp mở cổng ra 2: Thành viên đang trong bãi
        shouldOpen = 1;
        await membersRef.doc(memberSnapshot.docs[0].id).update({
          isCurrentlyIn: false,
          lastActivity: admin.firestore.Timestamp.fromDate(new Date())
        });
      }
    }
    // Những trường hợp không mở cổng ra
    // 1. Không phải khách, không phải thành viên
    // 2. Thành viên đang ở ngoài bãi
    await socket.emit("exitResponse", shouldOpen);
  });
});