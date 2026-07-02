package com.hzr.circlemap.plugins.gnss;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssStatus;
import android.location.LocationManager;
import android.location.OnNmeaMessageListener;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.ArrayList;
import java.util.List;

/**
 * GNSS 原始数据插件。
 *
 * 桥接 Android LocationManager 的卫星状态和 NMEA 数据到 JavaScript。
 * 可获取：卫星数、信噪比、星座类型、仰角/方位角、NMEA 原始语句。
 *
 * 事件:
 *   - "gnssStatus"   : GnssSatelliteInfo[] — 卫星状态更新 (~1s/次)
 *   - "nmeaSentence" : GnssNmeaData        — 每收到一条 NMEA 语句触发
 */
@CapacitorPlugin(
    name = "GnssData",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION }
        )
    }
)
public class GnssDataPlugin extends Plugin {

    private static final String TAG = "GnssDataPlugin";
    private static final int MAX_NMEA_CACHE = 50;

    private LocationManager locationManager;
    private GnssStatus.Callback gnssCallback;
    private OnNmeaMessageListener nmeaListener;

    private final List<GnssSatelliteInfo> lastSatellites = new ArrayList<>();
    private final List<GnssNmeaData> lastNmeaSentences = new ArrayList<>();
    private boolean isListening = false;

    // ──────────────────────────────────────────────
    // Plugin lifecycle
    // ──────────────────────────────────────────────

    @Override
    public void load() {
        super.load();
        Context ctx = getContext();
        if (ctx != null) {
            locationManager = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            Log.d(TAG, "Plugin loaded");
        }
    }

    // ──────────────────────────────────────────────
    // Plugin methods (exposed to JS)
    // ──────────────────────────────────────────────

    /**
     * 开始监听 GNSS 原始数据。
     * 需要 ACCESS_FINE_LOCATION 权限（已在 @CapacitorPlugin 中声明）。
     *
     * 启动后:
     *   - 卫星状态通过 "gnssStatus" 事件推送
     *   - NMEA 语句通过 "nmeaSentence" 事件推送
     */
    @PluginMethod
    public void startGnssListening(PluginCall call) {
        if (locationManager == null) {
            call.reject("LocationManager not available");
            return;
        }

        if (!hasPermission("location")) {
            call.reject("ACCESS_FINE_LOCATION permission not granted", "PERMISSION_DENIED");
            return;
        }

        try {
            registerGnssCallback();
            registerNmeaListener();
            isListening = true;
            Log.d(TAG, "GNSS listening started");
            call.resolve();
        } catch (SecurityException e) {
            call.reject("Location permission denied: " + e.getMessage(), "PERMISSION_DENIED");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start GNSS listening", e);
            call.reject("Failed to start GNSS listening: " + e.getMessage(), "UNKNOWN_ERROR");
        }
    }

    /**
     * 停止监听 GNSS 原始数据，释放回调。
     */
    @PluginMethod
    public void stopGnssListening(PluginCall call) {
        try {
            unregisterGnssCallback();
            unregisterNmeaListener();
            isListening = false;
            Log.d(TAG, "GNSS listening stopped");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop GNSS listening", e);
            call.reject("Failed to stop: " + e.getMessage(), "UNKNOWN_ERROR");
        }
    }

    /**
     * 返回最后一次缓存的卫星列表和 NMEA 语句快照。
     */
    @PluginMethod
    public void getLastGnssData(PluginCall call) {
        JSObject result = new JSObject();
        result.put("satellites", satellitesToJSArray(lastSatellites));
        result.put("nmea", nmeaToJSArray(lastNmeaSentences));
        call.resolve(result);
    }

    // ──────────────────────────────────────────────
    // GnssStatus.Callback (API 24+)
    // ──────────────────────────────────────────────

    private void registerGnssCallback() {
        if (gnssCallback != null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            gnssCallback = new GnssStatus.Callback() {
                @Override
                public void onSatelliteStatusChanged(GnssStatus status) {
                    handleSatelliteStatus(status);
                }

                @Override
                public void onStarted() {
                    Log.d(TAG, "GnssStatus callback started");
                }

                @Override
                public void onStopped() {
                    Log.d(TAG, "GnssStatus callback stopped");
                }

                @Override
                public void onFirstFix(int ttffMillis) {
                    Log.d(TAG, "First fix in " + ttffMillis + "ms");
                }
            };

            try {
                locationManager.registerGnssStatusCallback(gnssCallback, null, null);
                Log.d(TAG, "GnssStatus.Callback registered");
            } catch (SecurityException e) {
                gnssCallback = null;
                throw e;
            }
        } else {
            Log.w(TAG, "GnssStatus.Callback requires API 24+, current API: "
                    + Build.VERSION.SDK_INT + " — satellite detail unavailable");
        }
    }

    private void unregisterGnssCallback() {
        if (gnssCallback != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                locationManager.unregisterGnssStatusCallback(gnssCallback);
            }
            gnssCallback = null;
            lastSatellites.clear();
            Log.d(TAG, "GnssStatus.Callback unregistered");
        }
    }

    /**
     * 处理 GnssStatus 更新，提取卫星信息并推送到 JS。
     */
    private void handleSatelliteStatus(GnssStatus status) {
        lastSatellites.clear();
        int count = status.getSatelliteCount();

        for (int i = 0; i < count; i++) {
            GnssSatelliteInfo info = new GnssSatelliteInfo(
                    status.getSvid(i),
                    constellationTypeToString(status.getConstellationType(i)),
                    status.getCn0DbHz(i),
                    status.getElevationDegrees(i),
                    status.getAzimuthDegrees(i),
                    status.usedInFix(i),
                    status.hasEphemerisData(i),
                    status.hasAlmanacData(i)
            );
            lastSatellites.add(info);
        }

        // 推送给 JS 监听器
        JSObject event = new JSObject();
        event.put("satellites", satellitesToJSArray(lastSatellites));
        notifyListeners("gnssStatus", event);

        Log.d(TAG, "Satellites: " + count
                + " (used: " + countUsed(lastSatellites)
                + ", avg SNR: " + String.format("%.1f", avgSnr(lastSatellites)) + " dB-Hz)");
    }

    // ──────────────────────────────────────────────
    // NMEA Listener
    // ──────────────────────────────────────────────

    private void registerNmeaListener() {
        if (nmeaListener != null) return;

        nmeaListener = (sentence, timestamp) -> {
            GnssNmeaData data = new GnssNmeaData(timestamp, sentence);

            // 缓存（限制数量防内存泄漏）
            lastNmeaSentences.add(data);
            if (lastNmeaSentences.size() > MAX_NMEA_CACHE) {
                lastNmeaSentences.remove(0);
            }

            // 推送给 JS
            notifyListeners("nmeaSentence", data.toJSObject());

            Log.v(TAG, "NMEA: " + sentence.trim());
        };

        try {
            locationManager.addNmeaListener(nmeaListener, null);
            Log.d(TAG, "NmeaListener registered");
        } catch (SecurityException e) {
            nmeaListener = null;
            throw e;
        }
    }

    private void unregisterNmeaListener() {
        if (nmeaListener != null) {
            locationManager.removeNmeaListener(nmeaListener);
            nmeaListener = null;
            lastNmeaSentences.clear();
            Log.d(TAG, "NmeaListener unregistered");
        }
    }

    // ──────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────

    /**
     * Android GnssStatus 星座类型码 → 可读名称。
     */
    private static String constellationTypeToString(int type) {
        switch (type) {
            case GnssStatus.CONSTELLATION_GPS:     return "GPS";
            case GnssStatus.CONSTELLATION_SBAS:    return "SBAS";
            case GnssStatus.CONSTELLATION_GLONASS: return "GLONASS";
            case GnssStatus.CONSTELLATION_QZSS:    return "QZSS";
            case GnssStatus.CONSTELLATION_BEIDOU:  return "BEIDOU";
            case GnssStatus.CONSTELLATION_GALILEO: return "GALILEO";
            case GnssStatus.CONSTELLATION_IRNSS:   return "IRNSS";
            default: return "UNKNOWN";
        }
    }

    private static JSArray satellitesToJSArray(List<GnssSatelliteInfo> sats) {
        JSArray arr = new JSArray();
        for (GnssSatelliteInfo sat : sats) {
            arr.put(sat.toJSObject());
        }
        return arr;
    }

    private static JSArray nmeaToJSArray(List<GnssNmeaData> nmeaList) {
        JSArray arr = new JSArray();
        // 按时间倒序，最新的在前
        for (int i = nmeaList.size() - 1; i >= 0; i--) {
            arr.put(nmeaList.get(i).toJSObject());
        }
        return arr;
    }

    /** 计算参与定位的卫星数 */
    private static int countUsed(List<GnssSatelliteInfo> sats) {
        int n = 0;
        for (GnssSatelliteInfo s : sats) {
            if (s.isUsedInFix()) n++;
        }
        return n;
    }

    /** 计算平均信噪比（仅 usedInFix 的卫星） */
    private static double avgSnr(List<GnssSatelliteInfo> sats) {
        double sum = 0;
        int n = 0;
        for (GnssSatelliteInfo s : sats) {
            if (s.isUsedInFix()) {
                sum += s.getCn0DbHz();
                n++;
            }
        }
        return n > 0 ? sum / n : 0;
    }
}
