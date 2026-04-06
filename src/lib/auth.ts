import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

const provider = new GoogleAuthProvider();
// Restrict to @ingroenergy.com accounts
provider.setCustomParameters({ hd: "ingroenergy.com" });

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, provider);
  const email = result.user.email || "";

  // Double-check domain — sign out if not @ingroenergy.com
  if (!email.endsWith("@ingroenergy.com")) {
    await firebaseSignOut(auth);
    throw new Error("Only @ingroenergy.com accounts are allowed.");
  }

  return result.user;
}

export async function signOut() {
  await firebaseSignOut(auth);
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    // If user is signed in but not @ingroenergy.com, sign them out
    if (user && !user.email?.endsWith("@ingroenergy.com")) {
      firebaseSignOut(auth);
      callback(null);
      return;
    }
    callback(user);
  });
}
