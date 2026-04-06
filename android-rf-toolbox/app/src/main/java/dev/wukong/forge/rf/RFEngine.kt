package dev.wukong.forge.rf

import kotlin.math.*

/**
 * RF Propagation Engine — all calculations run offline.
 * Ported from the Forge web RF tools (tools.html) and
 * the React RF Terrain Propagation artifact.
 *
 * "It just runs programs."
 */
object RFEngine {

    // ── Protocol Database ────────────────────────────────────────────────────

    data class Protocol(
        val key: String, val name: String, val freqMHz: Int,
        val txPowerDbm: Int, val rxSensDbm: Int, val mod: String
    )

    val protocols = listOf(
        Protocol("GHST", "GHST (ImmersionRC)", 2400, 27, -108, "LoRa-like"),
        Protocol("ELRS_2G4", "ExpressLRS 2.4G", 2400, 27, -123, "LoRa"),
        Protocol("ELRS_900", "ExpressLRS 900M", 915, 27, -123, "LoRa"),
        Protocol("CRSF", "Crossfire (TBS)", 915, 30, -130, "LoRa"),
        Protocol("DJI_O3", "DJI O3/O4", 5800, 25, -93, "OFDM"),
        Protocol("HDZERO", "HDZero", 5800, 25, -90, "OFDM"),
        Protocol("WALKSNAIL", "Walksnail Avatar", 5800, 25, -92, "OFDM"),
        Protocol("ANALOG_FPV", "Analog FPV", 5800, 25, -85, "FM"),
        Protocol("DOODLE_MESH", "Doodle Labs Mesh", 2400, 30, -96, "OFDM"),
        Protocol("SILVUS", "Silvus StreamCaster", 1625, 33, -100, "MIMO-OFDM"),
        Protocol("RFD900X", "RFD900x", 915, 30, -121, "FHSS"),
        Protocol("PERSISTENT", "Persistent MPU5", 2400, 33, -98, "MIMO-OFDM"),
    )

    fun protocolByKey(key: String) = protocols.find { it.key == key } ?: protocols[2]

    // ── Terrain Types ────────────────────────────────────────────────────────

    data class TerrainType(val key: String, val name: String, val lossDbPerKm: Double, val desc: String)

    val terrainTypes = listOf(
        TerrainType("OPEN", "Open Field / Desert", 0.0, "Clear LOS, flat terrain"),
        TerrainType("SUBURBAN", "Suburban", 8.0, "Houses, light trees"),
        TerrainType("LIGHT_URBAN", "Light Urban", 15.0, "2-3 story buildings"),
        TerrainType("DENSE_URBAN", "Dense Urban", 25.0, "High-rise, narrow streets"),
        TerrainType("LIGHT_FOREST", "Light Forest", 10.0, "Sparse trees"),
        TerrainType("DENSE_FOREST", "Dense Forest", 20.0, "Thick canopy"),
        TerrainType("INDUSTRIAL", "Industrial", 18.0, "Metal structures, warehouses"),
        TerrainType("WATER", "Over Water", -2.0, "Reflective surface"),
        TerrainType("MOUNTAIN", "Mountainous", 30.0, "Terrain obstructions"),
    )

    // ── Obstacle Materials ───────────────────────────────────────────────────

    data class Obstacle(val key: String, val name: String, val lossDb: Double)

    val obstacles = listOf(
        Obstacle("DRYWALL", "Drywall", 3.0),
        Obstacle("WOOD", "Wood / Plywood", 4.0),
        Obstacle("GLASS", "Glass (standard)", 4.0),
        Obstacle("GLASS_TINTED", "Tinted / Low-E Glass", 10.0),
        Obstacle("BRICK", "Brick", 8.0),
        Obstacle("CONCRETE", "Concrete (6\")", 15.0),
        Obstacle("CONCRETE_REINFORCED", "Reinforced Concrete", 25.0),
        Obstacle("METAL", "Metal / Steel", 30.0),
        Obstacle("FOLIAGE", "Foliage (per 10m)", 6.0),
        Obstacle("EARTH", "Earth / Hillside", 40.0),
    )

    // ── Physics ──────────────────────────────────────────────────────────────

    /** Free Space Path Loss in dB */
    fun fspl(distKm: Double, freqMHz: Double): Double {
        if (distKm <= 0 || freqMHz <= 0) return 0.0
        return 20 * log10(distKm) + 20 * log10(freqMHz) + 32.44
    }

    /** Fresnel zone N radius at point d1/d2 in meters */
    fun fresnelRadius(d1m: Double, d2m: Double, freqMHz: Double, n: Int = 1): Double {
        val lambda = 300.0 / freqMHz
        val totalD = d1m + d2m
        if (totalD <= 0) return 0.0
        return sqrt(n * lambda * d1m * d2m / totalD)
    }

    /** Max range (km) from link budget */
    fun maxRange(
        txPowerDbm: Double, rxSensDbm: Double, txGainDbi: Double,
        rxGainDbi: Double, freqMHz: Double, additionalLossDb: Double = 0.0,
        fadeMarginDb: Double = 6.0
    ): Double {
        val allowable = txPowerDbm + txGainDbi + rxGainDbi - rxSensDbm - fadeMarginDb - additionalLossDb
        if (allowable <= 0) return 0.0
        val distLog = (allowable - 20 * log10(freqMHz) - 32.44) / 20
        return 10.0.pow(distLog)
    }

    /** Terrain-adjusted range using iterative solver */
    fun terrainRange(
        txPowerDbm: Double, rxSensDbm: Double, txGainDbi: Double,
        rxGainDbi: Double, freqMHz: Double, terrainKey: String,
        obstacleLossDb: Double = 0.0, fadeMarginDb: Double = 6.0
    ): Double {
        val terrain = terrainTypes.find { it.key == terrainKey } ?: terrainTypes[0]
        var lo = 0.001; var hi = 200.0
        repeat(50) {
            val mid = (lo + hi) / 2
            val totalLoss = fspl(mid, freqMHz) + terrain.lossDbPerKm * mid + obstacleLossDb + fadeMarginDb
            val budget = txPowerDbm + txGainDbi + rxGainDbi - rxSensDbm
            if (totalLoss < budget) lo = mid else hi = mid
        }
        return (lo + hi) / 2
    }

    /** Knife-edge diffraction loss (Deygout single-edge) */
    fun knifeEdgeLoss(v: Double): Double = when {
        v <= -0.78 -> 0.0
        v < 0 -> 6.02 + 9.11 * v + 1.27 * v * v
        else -> 6.02 + 9.0 * v + 1.65 * v * v
    }

    /** Fresnel-Kirchhoff parameter v */
    fun fresnelV(h: Double, d1m: Double, d2m: Double, freqMHz: Double): Double {
        val lambda = 300.0 / freqMHz
        val totalD = d1m + d2m
        if (totalD <= 0) return 0.0
        return h * sqrt(2.0 * totalD / (lambda * d1m * d2m))
    }

    /** Haversine distance in meters */
    fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        return R * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    // ── FPV Channel Data ─────────────────────────────────────────────────────

    data class ChannelBand(val key: String, val name: String, val freqs: List<Int>)

    val channelBands = listOf(
        ChannelBand("R", "Raceband", listOf(5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917)),
        ChannelBand("F", "Fatshark", listOf(5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880)),
        ChannelBand("E", "Boscam E", listOf(5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945)),
        ChannelBand("A", "Boscam A", listOf(5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725)),
        ChannelBand("B", "Boscam B", listOf(5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866)),
    )

    /** Check minimum channel separation in MHz */
    fun channelConflict(freq1: Int, freq2: Int): Int = abs(freq1 - freq2)

    /** Harmonics of a frequency */
    fun harmonics(freqMHz: Double, count: Int = 5): List<Double> =
        (2..count + 1).map { freqMHz * it }

    /** Dipole length (half-wave) in cm */
    fun dipoleLength(freqMHz: Double): Double {
        if (freqMHz <= 0) return 0.0
        return 14250.0 / freqMHz  // quarter-wave in cm, ×2 for half-wave / 100 for m... simplified: 142.5/f(MHz) in cm per element
    }

    /** Closest standard FPV channel to a frequency */
    fun closestChannel(freqMHz: Int): Pair<ChannelBand, Int>? {
        var best: Pair<ChannelBand, Int>? = null
        var bestDist = Int.MAX_VALUE
        for (band in channelBands) {
            for ((idx, f) in band.freqs.withIndex()) {
                val dist = abs(f - freqMHz)
                if (dist < bestDist) {
                    bestDist = dist
                    best = Pair(band, idx)
                }
            }
        }
        return best
    }

    // ── Link Budget ──────────────────────────────────────────────────────────

    data class LinkBudgetResult(
        val fsplDb: Double, val totalLossDb: Double, val rxPowerDbm: Double,
        val marginDb: Double, val linkOk: Boolean,
        val quality: String // excellent, good, marginal, weak, fail
    )

    fun linkBudget(
        distKm: Double, freqMHz: Double, txPowerDbm: Double,
        txGainDbi: Double, rxGainDbi: Double, rxSensDbm: Double,
        obstacleLossDb: Double = 0.0, diffractionLossDb: Double = 0.0,
        fadeMarginDb: Double = 6.0
    ): LinkBudgetResult {
        val fLoss = fspl(distKm, freqMHz)
        val total = fLoss + obstacleLossDb + diffractionLossDb
        val rxPower = txPowerDbm + txGainDbi + rxGainDbi - total
        val margin = rxPower - rxSensDbm - fadeMarginDb
        val quality = when {
            margin > 20 -> "excellent"
            margin > 10 -> "good"
            margin > 3 -> "marginal"
            margin > 0 -> "weak"
            else -> "fail"
        }
        return LinkBudgetResult(fLoss, total, rxPower, margin, margin > 0, quality)
    }
}
