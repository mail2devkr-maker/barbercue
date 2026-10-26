/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { GoogleSignInGate } from '../GoogleSignInGate';

jest.mock('../../../lib/google-signin', () => ({
  getGoogleIdToken: jest.fn(),
}));
jest.mock('../../../lib/auth-context', () => ({
  __mockGoogleLogin: jest.fn(),
  useAuth: () => ({
    googleLogin: jest.requireMock('../../../lib/auth-context').__mockGoogleLogin,
  }),
}));
jest.mock('../../../lib/language-context', () => ({
  useLanguage: () => ({
    t: {
      continueWithGoogle: 'Continue with Google',
      couldNotCompleteGoogleSignIn: 'Could not complete Google sign-in.',
      couldNotSignInWithGoogle: 'Could not sign in with Google.',
    },
  }),
}));
jest.mock('../../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
}));
jest.mock('../AppleSignInButton', () => ({ AppleSignInButton: () => null }));

const mockGetGoogleIdToken = jest.requireMock('../../../lib/google-signin').getGoogleIdToken as jest.Mock;
const mockGoogleLogin = jest.requireMock('../../../lib/auth-context').__mockGoogleLogin as jest.Mock;

describe('GoogleSignInGate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps Google available and preserves the guest intent before the auth session changes', async () => {
    const onBeforeSignIn = jest.fn();
    mockGetGoogleIdToken.mockResolvedValue({
      type: 'success',
      idToken: 'id-token',
    });
    let tree!: ReturnType<typeof TestRenderer.create>;

    await act(async () => {
      tree = TestRenderer.create(
        createElement(GoogleSignInGate, {
          label: 'Sign in to continue',
          onBeforeSignIn,
        }),
      );
    });

    const googleButton = tree.root.findAll(
      (node: { props: { onPress?: unknown } }) => typeof node.props.onPress === 'function',
    )[0];
    await act(async () => googleButton.props.onPress());
    expect(mockGoogleLogin).toHaveBeenCalledWith({ idToken: 'id-token' });
    expect(onBeforeSignIn).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });
});
