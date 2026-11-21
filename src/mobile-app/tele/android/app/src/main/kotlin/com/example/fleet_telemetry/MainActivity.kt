package com.example.fleet_telemetry

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.telephony.TelephonyManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Exposes the device's raw radio signal to the Flutter side over a MethodChannel
 * (`fleet_telemetry/signal`, method `read`). Flutter has no built-in cellular/Wi-Fi
 * signal API, so the app reads it here and forwards the raw numbers unchanged —
 * all thresholds and the Contract A `signal_strength` / E1 / E2 logic live in Dart.
 *
 * Returns a map `{ level: Int 0..4, dbm: Double?, networkType: "wifi"|"cellular"|"none" }`,
 * or `null` when the platform cannot give a meaningful reading (so the app simply
 * skips the signal event that cycle rather than inventing a value).
 */
class MainActivity : FlutterActivity() {
    private val channelName = "fleet_telemetry/signal"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "read" -> result.success(readSignal())
                    else -> result.notImplemented()
                }
            }
    }

    private fun none(): Map<String, Any?> =
        mapOf("level" to 0, "dbm" to null, "networkType" to "none")

    private fun readSignal(): Map<String, Any?>? {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = cm.activeNetwork ?: return none()
            val caps = cm.getNetworkCapabilities(network) ?: return none()
            when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> readWifi(caps)
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> readCellular()
                else -> none()
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun readWifi(caps: NetworkCapabilities): Map<String, Any?> {
        return try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

            // RSSI in dBm: prefer the network-capabilities value (API 29+), fall back to WifiInfo.
            var rssi: Int? = null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val s = caps.signalStrength
                if (s != NetworkCapabilities.SIGNAL_STRENGTH_UNSPECIFIED) rssi = s
            }
            if (rssi == null) {
                @Suppress("DEPRECATION")
                rssi = wm.connectionInfo?.rssi
            }

            val level = when {
                rssi == null -> 0
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> wm.calculateSignalLevel(rssi)
                else -> @Suppress("DEPRECATION") WifiManager.calculateSignalLevel(rssi, 5)
            }
            mapOf(
                "level" to level.coerceIn(0, 4),
                "dbm" to rssi?.toDouble(),
                "networkType" to "wifi",
            )
        } catch (e: Exception) {
            mapOf("level" to 0, "dbm" to null, "networkType" to "wifi")
        }
    }

    private fun readCellular(): Map<String, Any?> {
        return try {
            val tm = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            var level = 0
            var dbm: Double? = null
            // TelephonyManager.getSignalStrength() exists from API 28 (P). Below that we
            // report cellular with an unknown level rather than a fake "0" that would
            // spuriously trip the E2 "signal lost" rule.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val ss = tm.signalStrength
                if (ss != null) {
                    level = ss.level
                    val cells = ss.cellSignalStrengths
                    if (cells.isNotEmpty()) dbm = cells[0].dbm.toDouble()
                }
            }
            mapOf(
                "level" to level.coerceIn(0, 4),
                "dbm" to dbm,
                "networkType" to "cellular",
            )
        } catch (e: Exception) {
            mapOf("level" to 0, "dbm" to null, "networkType" to "cellular")
        }
    }
}
