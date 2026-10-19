import firebaseConfig from '../../firebase-applet-config.json';

export interface DecodedFirebaseToken {
  uid: string;
  email?: string;
  name?: string;
}

export const adminAuth = {
  async verifyIdToken(idToken: string): Promise<DecodedFirebaseToken> {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!response.ok) {
      throw new Error('Invalid Firebase ID token');
    }

    const data = (await response.json()) as {
      users?: Array<{
        localId: string;
        email?: string;
        displayName?: string;
      }>;
    };

    const user = data.users?.[0];
    if (!user?.localId) {
      throw new Error('Firebase user not found for token');
    }

    return {
      uid: user.localId,
      email: user.email,
      name: user.displayName,
    };
  },
};
