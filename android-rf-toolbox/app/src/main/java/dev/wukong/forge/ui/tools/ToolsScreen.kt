package dev.wukong.forge.ui.tools

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.wukong.forge.rf.RFEngine
import dev.wukong.forge.ui.*
import dev.wukong.forge.util.CoordUtil
import kotlin.math.abs

// ═══════════════════════════════════════════════════════════════════════════════
// RANGE ESTIMATOR
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun RangeEstimator() {
    var protocol by remember { mutableStateOf("ELRS_900") }
    var txPower by remember { mutableStateOf("27") }
    var txGain by remember { mutableStateOf("2") }
    var rxGain by remember { mutableStateOf("2") }
    var fadeMargin by remember { mutableStateOf("6") }
    var terrain by remember { mutableStateOf("OPEN") }

    val proto = RFEngine.protocolByKey(protocol)

    // Compare all protocols
    val allRanges = remember(txPower, txGain, rxGain, fadeMargin, terrain) {
        RFEngine.protocols.map { p ->
            val tr = RFEngine.terrainRange(
                txPower.toDoubleOrNull() ?: 27.0, p.rxSensDbm.toDouble(),
                txGain.toDoubleOrNull() ?: 2.0, rxGain.toDoubleOrNull() ?: 2.0,
                p.freqMHz.toDouble(), terrain, 0.0, fadeMargin.toDoubleOrNull() ?: 6.0
            )
            Triple(p.key, p.name, tr)
        }.sortedByDescending { it.third }
    }

    val fsplRange = RFEngine.maxRange(
        txPower.toDoubleOrNull() ?: 27.0, proto.rxSensDbm.toDouble(),
        txGain.toDoubleOrNull() ?: 2.0, rxGain.toDoubleOrNull() ?: 2.0,
        proto.freqMHz.toDouble(), 0.0, fadeMargin.toDoubleOrNull() ?: 6.0
    )
    val terrRange = allRanges.find { it.first == protocol }?.third ?: 0.0

    ScrollTool {
        ToolHeader("Range Estimator", "Max range by protocol and terrain")
        ProtocolSelector(protocol) { protocol = it }
        ParamGrid(
            "TX Power" to txPower, "Fade Margin" to fadeMargin,
            "TX Gain" to txGain, "RX Gain" to rxGain,
            onChange = { k, v -> when(k) { "TX Power" -> txPower = v; "Fade Margin" -> fadeMargin = v; "TX Gain" -> txGain = v; "RX Gain" -> rxGain = v } }
        )
        TerrainSelector(terrain) { terrain = it }

        Spacer(Modifier.height(12.dp))
        ResultRow("FSPL Range", "%.2f km".format(fsplRange), ForgeAccent)
        ResultRow("Terrain Range", "%.2f km".format(terrRange), if (terrRange < 1) ForgeRed else ForgeGreen)

        Spacer(Modifier.height(12.dp))
        SectionLabel("PROTOCOL COMPARISON")
        val maxRange = allRanges.maxOfOrNull { it.third } ?: 1.0
        allRanges.forEach { (key, name, range) ->
            RangeBar(name, range, maxRange, if (key == protocol) ForgeAccent else ForgeFaint)
        }
        ProtoInfo(proto)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LINK BUDGET
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun LinkBudgetTool() {
    var protocol by remember { mutableStateOf("ELRS_900") }
    var distance by remember { mutableStateOf("1.0") }
    var txPower by remember { mutableStateOf("27") }
    var txGain by remember { mutableStateOf("2") }
    var rxGain by remember { mutableStateOf("2") }
    var fadeMargin by remember { mutableStateOf("6") }

    val proto = RFEngine.protocolByKey(protocol)
    val result = RFEngine.linkBudget(
        distance.toDoubleOrNull() ?: 1.0, proto.freqMHz.toDouble(),
        txPower.toDoubleOrNull() ?: 27.0, txGain.toDoubleOrNull() ?: 2.0,
        rxGain.toDoubleOrNull() ?: 2.0, proto.rxSensDbm.toDouble(),
        fadeMarginDb = fadeMargin.toDoubleOrNull() ?: 6.0,
    )
    val qualColor = when (result.quality) { "excellent", "good" -> ForgeGreen; "marginal" -> ForgeYellow; else -> ForgeRed }

    ScrollTool {
        ToolHeader("Link Budget", "Full dB-by-dB waterfall analysis")
        ProtocolSelector(protocol) { protocol = it }
        ParamRow("Distance (km)", distance) { distance = it }
        ParamGrid(
            "TX Power" to txPower, "Fade Margin" to fadeMargin,
            "TX Gain" to txGain, "RX Gain" to rxGain,
            onChange = { k, v -> when(k) { "TX Power" -> txPower = v; "Fade Margin" -> fadeMargin = v; "TX Gain" -> txGain = v; "RX Gain" -> rxGain = v } }
        )

        Spacer(Modifier.height(12.dp))

        // Budget breakdown
        SectionLabel("BUDGET BREAKDOWN")
        BudgetRow("TX Power", "+${txPower}", "dBm", ForgeGreen)
        BudgetRow("TX Antenna", "+${txGain}", "dBi", ForgeGreen)
        BudgetRow("RX Antenna", "+${rxGain}", "dBi", ForgeGreen)
        BudgetRow("Free Space Loss", "-${"%.1f".format(result.fsplDb)}", "dB", ForgeRed)
        BudgetRow("Fade Margin", "-${fadeMargin}", "dB", ForgeYellow)
        Divider(color = ForgeBorder, modifier = Modifier.padding(vertical = 6.dp))
        BudgetRow("Received Power", "%.1f".format(result.rxPowerDbm), "dBm", ForgeAccent)
        BudgetRow("RX Sensitivity", "${proto.rxSensDbm}", "dBm", ForgeDim)
        BudgetRow("Link Margin", "%.1f".format(result.marginDb), "dB", qualColor)

        Spacer(Modifier.height(8.dp))
        ResultRow("Quality", result.quality.uppercase(), qualColor)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRESNEL ZONE
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun FresnelTool() {
    var protocol by remember { mutableStateOf("ELRS_900") }
    var distance by remember { mutableStateOf("1000") }
    var clearance by remember { mutableStateOf("8") }

    val proto = RFEngine.protocolByKey(protocol)
    val mid = (distance.toDoubleOrNull() ?: 1000.0) / 2
    val r1 = RFEngine.fresnelRadius(mid, mid, proto.freqMHz.toDouble(), 1)
    val r60 = r1 * 0.6
    val cl = clearance.toDoubleOrNull() ?: 8.0
    val ok = cl >= r60
    val lossEst = if (ok) 0.0 else minOf(20.0, (1 - cl / r60) * 15)

    ScrollTool {
        ToolHeader("Fresnel Zone", "Zone 1 radius and 60% clearance")
        ProtocolSelector(protocol) { protocol = it }
        ParamRow("Distance (m)", distance) { distance = it }
        ParamRow("Clearance (m)", clearance) { clearance = it }

        Spacer(Modifier.height(12.dp))
        ResultRow("Zone 1 Radius", "%.1f m".format(r1), ForgeAccent)
        ResultRow("60% Clearance", "%.1f m".format(r60), ForgeAccent)
        ResultRow("Status", if (ok) "CLEAR" else "OBSTRUCTED", if (ok) ForgeGreen else ForgeRed)
        ResultRow("Est. Loss", "%.1f dB".format(lossEst), if (lossEst > 3) ForgeRed else ForgeGreen)
        ProtoInfo(proto)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHANNEL PLANNER
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun ChannelPlanner() {
    var p1Band by remember { mutableStateOf("R") }
    var p1Ch by remember { mutableStateOf(0) }
    var p2Band by remember { mutableStateOf("R") }
    var p2Ch by remember { mutableStateOf(6) }

    fun getFreq(band: String, ch: Int): Int {
        val b = RFEngine.channelBands.find { it.key == band } ?: return 0
        return b.freqs.getOrNull(ch) ?: 0
    }

    val f1 = getFreq(p1Band, p1Ch)
    val f2 = getFreq(p2Band, p2Ch)
    val sep = abs(f1 - f2)
    val sepOk = sep >= 37 // 37 MHz minimum for analog, less for digital

    ScrollTool {
        ToolHeader("Channel Planner", "Check channel separation between pilots")
        SectionLabel("PILOT 1")
        Text("${p1Band}${p1Ch + 1}: $f1 MHz", color = ForgeAccent, fontSize = 16.sp, fontWeight = FontWeight.Bold, fontFamily = Mono)
        SectionLabel("PILOT 2")
        Text("${p2Band}${p2Ch + 1}: $f2 MHz", color = ForgePurple, fontSize = 16.sp, fontWeight = FontWeight.Bold, fontFamily = Mono)

        Spacer(Modifier.height(12.dp))
        ResultRow("Separation", "$sep MHz", if (sepOk) ForgeGreen else ForgeRed)
        ResultRow("Status", if (sepOk) "OK" else "TOO CLOSE", if (sepOk) ForgeGreen else ForgeRed)

        Spacer(Modifier.height(8.dp))
        Disclaimer("Minimum 37 MHz separation for analog FPV. Digital systems (DJI, HDZero, Walksnail) can tolerate less but still benefit from spacing.")
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HARMONICS
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun HarmonicsTool() {
    var freq by remember { mutableStateOf("490") }
    val f = freq.toDoubleOrNull() ?: 490.0
    val harmonics = RFEngine.harmonics(f, 6)

    ScrollTool {
        ToolHeader("Harmonics Calculator", "Harmonic frequencies with GPS/GNSS proximity warnings")
        ParamRow("Fundamental (MHz)", freq) { freq = it }
        Spacer(Modifier.height(12.dp))

        harmonics.forEachIndexed { i, h ->
            val n = i + 2
            val gpsL1 = abs(h - 1575.42)
            val gpsL2 = abs(h - 1227.60)
            val gpsL5 = abs(h - 1176.45)
            val warn = gpsL1 < 150 || gpsL2 < 100 || gpsL5 < 100
            val suffix = when {
                gpsL1 < 30 -> "  ⚠ ON GPS L1!"
                gpsL1 < 150 -> "  ⚠ Near L1 (${gpsL1.toInt()} MHz)"
                gpsL2 < 30 -> "  ⚠ ON GPS L2!"
                gpsL2 < 100 -> "  ⚠ Near L2 (${gpsL2.toInt()} MHz)"
                gpsL5 < 100 -> "  ⚠ Near L5 (${gpsL5.toInt()} MHz)"
                else -> ""
            }
            ResultRow(
                "${n}${ordinalSuffix(n)} harmonic",
                "${"%.1f".format(h)} MHz$suffix",
                if (warn) ForgeRed else ForgeDim,
            )
        }

        Spacer(Modifier.height(12.dp))
        Disclaimer("GPS L1: 1575.42 MHz · L2: 1227.60 MHz · L5: 1176.45 MHz. At high TX power (>1W), harmonics within 150 MHz of a GNSS band risk desensing co-located GPS receivers. Add an output LPF.")
    }
}

private fun ordinalSuffix(n: Int) = when { n == 2 -> "nd"; n == 3 -> "rd"; else -> "th" }

// ═══════════════════════════════════════════════════════════════════════════════
// DIPOLE LENGTH
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun DipoleTool() {
    var freq by remember { mutableStateOf("915") }
    val f = freq.toDoubleOrNull() ?: 915.0
    val element = RFEngine.dipoleLength(f)

    ScrollTool {
        ToolHeader("Dipole Length", "Half-wave antenna element length")
        ParamRow("Frequency (MHz)", freq) { freq = it }
        Spacer(Modifier.height(12.dp))
        ResultRow("Element (¼λ)", "%.2f cm".format(element), ForgeAccent)
        ResultRow("Full Dipole (½λ)", "%.2f cm".format(element * 2), ForgeAccent)
        ResultRow("Wavelength (λ)", "%.2f cm".format(element * 4), ForgeDim)

        Spacer(Modifier.height(12.dp))
        SectionLabel("QUICK REFERENCE")
        listOf(433, 868, 915, 1300, 2400, 5800).forEach { mhz ->
            val l = RFEngine.dipoleLength(mhz.toDouble())
            ResultRow("$mhz MHz", "%.1f cm".format(l * 2), ForgeFaint)
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RF TERRAIN MAP (coordinate input + map placeholder)
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun TerrainTool() {
    var txInput by remember { mutableStateOf("39.7392, -104.9903") }
    var rxInput by remember { mutableStateOf("39.7600, -104.9500") }
    var coordFormat by remember { mutableStateOf(CoordUtil.Format.DD) }
    var protocol by remember { mutableStateOf("ELRS_900") }
    var txHeight by remember { mutableStateOf("2") }
    var rxHeight by remember { mutableStateOf("50") }

    val txCoord = CoordUtil.parse(txInput)
    val rxCoord = CoordUtil.parse(rxInput)
    val proto = RFEngine.protocolByKey(protocol)

    val distKm = if (txCoord != null && rxCoord != null)
        RFEngine.haversine(txCoord.lat, txCoord.lon, rxCoord.lat, rxCoord.lon) / 1000.0
    else 0.0

    val budget = if (distKm > 0) RFEngine.linkBudget(
        distKm, proto.freqMHz.toDouble(), 27.0, 2.0, 2.0,
        proto.rxSensDbm.toDouble(), fadeMarginDb = 6.0
    ) else null

    ScrollTool {
        ToolHeader("RF Terrain Propagation", "Enter TX/RX coordinates in any format")

        // Format toggle
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            horizontalArrangement = Arrangement.End,
        ) {
            Text(
                "Format: ${coordFormat.name}",
                color = ForgeAccent, fontSize = 11.sp, fontFamily = Mono, fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .background(ForgeAccent.copy(alpha = 0.1f), RoundedCornerShape(4.dp))
                    .clickable { coordFormat = CoordUtil.nextFormat(coordFormat) }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }

        // TX coordinate
        CoordInput("TX Position", txInput, coordFormat) { txInput = it }
        txCoord?.let { ShowAllFormats(it.lat, it.lon) }
        Spacer(Modifier.height(8.dp))

        // RX coordinate
        CoordInput("RX Position", rxInput, coordFormat) { rxInput = it }
        rxCoord?.let { ShowAllFormats(it.lat, it.lon) }

        Spacer(Modifier.height(8.dp))
        ProtocolSelector(protocol) { protocol = it }
        ParamRow("TX Height AGL (m)", txHeight) { txHeight = it }
        ParamRow("RX Height AGL (m)", rxHeight) { rxHeight = it }

        if (distKm > 0) {
            Spacer(Modifier.height(12.dp))
            ResultRow("Distance", "%.3f km".format(distKm), ForgeAccent)
            budget?.let { b ->
                val qc = when (b.quality) { "excellent", "good" -> ForgeGreen; "marginal" -> ForgeYellow; else -> ForgeRed }
                ResultRow("FSPL", "%.1f dB".format(b.fsplDb), ForgeAccent)
                ResultRow("RX Power", "%.1f dBm".format(b.rxPowerDbm), if (b.linkOk) ForgeGreen else ForgeRed)
                ResultRow("Link Margin", "%.1f dB".format(b.marginDb), qc)
                ResultRow("Quality", b.quality.uppercase(), qc)
            }
        }

        Spacer(Modifier.height(12.dp))
        Disclaimer("Elevation profile and Fresnel overlay require online elevation data (SRTM/3DEP). Full terrain analysis available at forgeprole.netlify.app/tools/")
    }
}

@Composable
fun CoordInput(label: String, value: String, format: CoordUtil.Format, onChange: (String) -> Unit) {
    Column {
        Text(label, color = ForgeDim, fontSize = 10.sp, fontFamily = Mono, letterSpacing = 1.sp)
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = {
                Text(
                    when (format) {
                        CoordUtil.Format.DD -> "39.7392, -104.9903"
                        CoordUtil.Format.DMS -> "39°44'21\"N 104°59'25\"W"
                        CoordUtil.Format.MGRS -> "13SDE8401012345"
                        CoordUtil.Format.UTM -> "13S 484010 4397012"
                    },
                    color = ForgeFaint, fontSize = 12.sp, fontFamily = Mono,
                )
            },
            modifier = Modifier.fillMaxWidth(),
            textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Mono, fontSize = 13.sp, color = ForgeAccent),
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = ForgeAccent, unfocusedBorderColor = ForgeBorder, cursorColor = ForgeAccent,
            ),
        )
    }
}

@Composable
fun ShowAllFormats(lat: Double, lon: Double) {
    Row(modifier = Modifier.fillMaxWidth().padding(start = 4.dp, top = 2.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        CoordUtil.formats.forEach { fmt ->
            Text(CoordUtil.format(lat, lon, fmt), color = ForgeFaint, fontSize = 9.sp, fontFamily = Mono, maxLines = 1)
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COORDINATE CONVERTER (standalone tool)
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun CoordinateConverter() {
    var input by remember { mutableStateOf("") }
    val parsed = CoordUtil.parse(input)

    ScrollTool {
        ToolHeader("Coordinate Converter", "Enter coordinates in any format — DD, DMS, MGRS, or UTM")

        OutlinedTextField(
            value = input,
            onValueChange = { input = it },
            placeholder = { Text("39.7392, -104.9903  or  13SDE8401012345", color = ForgeFaint, fontFamily = Mono, fontSize = 12.sp) },
            modifier = Modifier.fillMaxWidth(),
            textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Mono, fontSize = 14.sp, color = ForgeAccent),
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = ForgeAccent, unfocusedBorderColor = ForgeBorder, cursorColor = ForgeAccent,
            ),
        )

        parsed?.let { c ->
            Spacer(Modifier.height(16.dp))
            CoordUtil.formats.forEach { fmt ->
                ResultRow(fmt.name, CoordUtil.format(c.lat, c.lon, fmt), ForgeAccent)
            }
        } ?: run {
            if (input.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text("Could not parse coordinates", color = ForgeRed, fontSize = 11.sp, fontFamily = Mono)
            }
        }

        Spacer(Modifier.height(16.dp))
        SectionLabel("ACCEPTED FORMATS")
        Text("DD:   39.7392, -104.9903", color = ForgeDim, fontSize = 11.sp, fontFamily = Mono)
        Text("DMS:  39°44'21\"N 104°59'25\"W", color = ForgeDim, fontSize = 11.sp, fontFamily = Mono)
        Text("MGRS: 13SDE8401012345", color = ForgeDim, fontSize = 11.sp, fontFamily = Mono)
        Text("UTM:  13S 484010 4397012", color = ForgeDim, fontSize = 11.sp, fontFamily = Mono)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

@Composable
fun ScrollTool(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        content = content,
    )
}

@Composable
fun ToolHeader(title: String, desc: String) {
    Text(title, color = ForgeText, fontSize = 18.sp, fontWeight = FontWeight.Bold, fontFamily = Mono)
    Text(desc, color = ForgeDim, fontSize = 11.sp, fontFamily = Mono, modifier = Modifier.padding(bottom = 12.dp))
}

@Composable
fun SectionLabel(text: String) {
    Text(
        text, color = ForgeFaint, fontSize = 9.sp, fontWeight = FontWeight.SemiBold,
        fontFamily = Mono, letterSpacing = 2.sp,
        modifier = Modifier.padding(top = 8.dp, bottom = 6.dp),
    )
}

@Composable
fun ParamRow(label: String, value: String, onChange: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = ForgeDim, fontSize = 11.sp, fontFamily = Mono, modifier = Modifier.weight(1f))
        OutlinedTextField(
            value = value, onValueChange = onChange,
            modifier = Modifier.width(100.dp).height(46.dp),
            textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Mono, fontSize = 14.sp, color = ForgeAccent),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = ForgeAccent, unfocusedBorderColor = ForgeBorder, cursorColor = ForgeAccent),
        )
    }
}

@Composable
fun ParamGrid(vararg params: Pair<String, String>, onChange: (String, String) -> Unit) {
    Column {
        params.toList().chunked(2).forEach { row ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (label, value) ->
                    Row(modifier = Modifier.weight(1f).padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(label, color = ForgeDim, fontSize = 10.sp, fontFamily = Mono, modifier = Modifier.weight(1f))
                        OutlinedTextField(
                            value = value, onValueChange = { onChange(label, it) },
                            modifier = Modifier.width(70.dp).height(42.dp),
                            textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Mono, fontSize = 13.sp, color = ForgeAccent),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = ForgeAccent, unfocusedBorderColor = ForgeBorder, cursorColor = ForgeAccent),
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ResultRow(label: String, value: String, color: androidx.compose.ui.graphics.Color) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)
            .background(ForgeCard, RoundedCornerShape(6.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = ForgeDim, fontSize = 11.sp, fontFamily = Mono)
        Text(value, color = color, fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = Mono)
    }
}

@Composable
fun BudgetRow(label: String, value: String, unit: String, color: androidx.compose.ui.graphics.Color) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = ForgeDim, fontSize = 11.sp, fontFamily = Mono)
        Text("$value $unit", color = color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, fontFamily = Mono)
    }
}

@Composable
fun RangeBar(label: String, value: Double, max: Double, color: androidx.compose.ui.graphics.Color) {
    val pct = if (max > 0) (value / max).coerceIn(0.0, 1.0).toFloat() else 0f
    Column(modifier = Modifier.padding(vertical = 2.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = ForgeDim, fontSize = 9.sp, fontFamily = Mono, maxLines = 1, modifier = Modifier.weight(1f))
            Text("%.2f km".format(value), color = color, fontSize = 10.sp, fontWeight = FontWeight.Bold, fontFamily = Mono)
        }
        Box(modifier = Modifier.fillMaxWidth().height(6.dp).background(ForgeDark, RoundedCornerShape(3.dp))) {
            Box(modifier = Modifier.fillMaxWidth(pct).height(6.dp).background(color.copy(alpha = 0.6f), RoundedCornerShape(3.dp)))
        }
    }
}

@Composable
fun Disclaimer(text: String) {
    Text("⚠ $text", color = ForgeFaint, fontSize = 9.sp, fontFamily = Mono, lineHeight = 13.sp,
        modifier = Modifier.padding(top = 8.dp))
}

@Composable
fun ProtocolSelector(selected: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val proto = RFEngine.protocolByKey(selected)
    Box {
        Text(proto.name, color = ForgeAccent, fontSize = 12.sp, fontFamily = Mono,
            modifier = Modifier.fillMaxWidth().background(ForgeCard, RoundedCornerShape(6.dp)).clickable { expanded = true }.padding(12.dp))
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            RFEngine.protocols.forEach { p ->
                DropdownMenuItem(text = { Text(p.name, fontFamily = Mono, fontSize = 12.sp) }, onClick = { onSelect(p.key); expanded = false })
            }
        }
    }
    Spacer(Modifier.height(6.dp))
}

@Composable
fun TerrainSelector(selected: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val t = RFEngine.terrainTypes.find { it.key == selected } ?: RFEngine.terrainTypes[0]
    Box {
        Text("${t.name} (${t.lossDbPerKm} dB/km)", color = ForgeAccent, fontSize = 12.sp, fontFamily = Mono,
            modifier = Modifier.fillMaxWidth().background(ForgeCard, RoundedCornerShape(6.dp)).clickable { expanded = true }.padding(12.dp))
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            RFEngine.terrainTypes.forEach { t ->
                DropdownMenuItem(text = { Text("${t.name} (${t.lossDbPerKm} dB/km)", fontFamily = Mono, fontSize = 12.sp) },
                    onClick = { onSelect(t.key); expanded = false })
            }
        }
    }
    Spacer(Modifier.height(6.dp))
}

@Composable
fun ProtoInfo(proto: RFEngine.Protocol) {
    Row(modifier = Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("${proto.freqMHz} MHz", color = ForgeFaint, fontSize = 9.sp, fontFamily = Mono)
        Text("${proto.rxSensDbm} dBm", color = ForgeFaint, fontSize = 9.sp, fontFamily = Mono)
        Text(proto.mod, color = ForgeFaint, fontSize = 9.sp, fontFamily = Mono)
    }
}
