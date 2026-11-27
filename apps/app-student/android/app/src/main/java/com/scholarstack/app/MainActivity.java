package com.scholarstack.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String SCHEME = "com.scholarstack.app";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PartnerSetupPlugin.class);
        super.onCreate(savedInstanceState);
        finishSignIn(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        finishSignIn(intent);
    }

    /**
     * Google and the email link sign in through the phone's browser (Google refuses sign-in
     * inside apps), which sends the student back to "com.scholarstack.app://auth/callback?code=…". The
     * code is finished on the site's own /auth/callback inside the app, where the sign-in began
     * (its one-time key is stored there), so the student ends up signed in in the app.
     */
    private void finishSignIn(Intent intent) {
        if (intent == null || bridge == null) return;
        Uri data = intent.getData();
        if (data == null || !SCHEME.equals(data.getScheme()) || !"auth".equals(data.getHost())) return;
        Uri app = Uri.parse(bridge.getAppUrl());
        String query = data.getEncodedQuery();
        String fragment = data.getEncodedFragment();
        String target =
            app.getScheme() + "://" + app.getEncodedAuthority() + "/auth/callback"
                + (query != null ? "?" + query : "")
                + (fragment != null ? "#" + fragment : "");
        // Only once: rotating the screen must not repeat it.
        intent.setData(null);
        bridge.getWebView().post(() -> bridge.getWebView().loadUrl(target));
    }
}
