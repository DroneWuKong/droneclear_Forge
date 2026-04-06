package dev.wukong.forge.util

import mil.nga.mgrs.MGRS
import mil.nga.grid.features.Point
import kotlin.math.abs
import kotlin.math.floor

/**
 * Coordinate format conversion — DD, DMS, MGRS, UTM.
 * Uses NGA official MGRS library (mil.nga.mgrs).
 * All conversions work offline.
 */
object CoordUtil {

    enum class Format { DD, DMS, MGRS, UTM }

    val formats = Format.entries.toList()

    fun nextFormat(current: Format): Format {
        val idx = formats.indexOf(current)
        return formats[(idx + 1) % formats.size]
    }

    // ── To String ────────────────────────────────────────────────────────────

    fun format(lat: Double, lon: Double, fmt: Format): String = when (fmt) {
        Format.DD -> formatDD(lat, lon)
        Format.DMS -> formatDMS(lat, lon)
        Format.MGRS -> formatMGRS(lat, lon)
        Format.UTM -> formatUTM(lat, lon)
    }

    fun formatDD(lat: Double, lon: Double): String =
        "%.6f, %.6f".format(lat, lon)

    fun formatDMS(lat: Double, lon: Double): String {
        val latD = dmsString(abs(lat), if (lat >= 0) "N" else "S")
        val lonD = dmsString(abs(lon), if (lon >= 0) "E" else "W")
        return "$latD  $lonD"
    }

    fun formatMGRS(lat: Double, lon: Double): String {
        return try {
            val point = Point.point(lon, lat)
            val mgrs = MGRS.from(point)
            mgrs.coordinate(5) // 1m precision
        } catch (e: Exception) {
            "MGRS error"
        }
    }

    fun formatUTM(lat: Double, lon: Double): String {
        return try {
            val point = Point.point(lon, lat)
            val mgrs = MGRS.from(point)
            val utm = mgrs.utm
            "%d%s %.0f %.0f".format(utm.zone, utm.hemisphere.name.first(), utm.easting, utm.northing)
        } catch (e: Exception) {
            "UTM error"
        }
    }

    private fun dmsString(decimal: Double, dir: String): String {
        val d = floor(decimal).toInt()
        val mFull = (decimal - d) * 60
        val m = floor(mFull).toInt()
        val s = (mFull - m) * 60
        return "%d°%02d'%05.2f\"%s".format(d, m, s, dir)
    }

    // ── Parse (any format) ───────────────────────────────────────────────────

    data class LatLon(val lat: Double, val lon: Double)

    /**
     * Parse a coordinate string in any supported format.
     * Returns null if parsing fails.
     */
    fun parse(input: String): LatLon? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null

        // Try MGRS first (starts with digit, has letters)
        if (trimmed[0].isDigit() && trimmed.any { it.isLetter() } && !trimmed.contains(',')) {
            return parseMGRS(trimmed)
        }

        // Try DD (two numbers separated by comma or space)
        parseDD(trimmed)?.let { return it }

        // Try DMS
        parseDMS(trimmed)?.let { return it }

        return null
    }

    fun parseMGRS(input: String): LatLon? {
        return try {
            val mgrs = MGRS.parse(input.trim().uppercase())
            val point = mgrs.toPoint()
            LatLon(point.latitude, point.longitude)
        } catch (e: Exception) {
            null
        }
    }

    fun parseDD(input: String): LatLon? {
        // "39.7392, -104.9903" or "39.7392 -104.9903"
        val parts = input.split(Regex("[,\\s]+")).filter { it.isNotBlank() }
        if (parts.size != 2) return null
        val lat = parts[0].toDoubleOrNull() ?: return null
        val lon = parts[1].toDoubleOrNull() ?: return null
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
        return LatLon(lat, lon)
    }

    fun parseDMS(input: String): LatLon? {
        // "39°44'21.12"N 104°59'25.08"W"
        val regex = Regex("""(\d+)[°](\d+)[']([0-9.]+)["]?\s*([NSEW])""")
        val matches = regex.findAll(input).toList()
        if (matches.size != 2) return null

        fun toDec(m: MatchResult): Double {
            val d = m.groupValues[1].toDouble()
            val min = m.groupValues[2].toDouble()
            val sec = m.groupValues[3].toDouble()
            val dir = m.groupValues[4]
            val dec = d + min / 60 + sec / 3600
            return if (dir == "S" || dir == "W") -dec else dec
        }

        val lat = toDec(matches[0])
        val lon = toDec(matches[1])
        return LatLon(lat, lon)
    }
}
