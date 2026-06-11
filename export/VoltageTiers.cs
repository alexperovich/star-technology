namespace export;

public static class VoltageTiers
{
    public static string[] voltageTiers = new string[] { "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV", "UXV", "MAX" };


    public static int GetVoltageTier(string gtVoltageTier)
    {
        switch (gtVoltageTier)
        {
            case "LV": return 0;
            case "MV": return 1;
            case "HV": return 2;
            case "EV": return 3;
            case "IV": return 4;
            case "LuV": return 5;
            case "ZPM": return 6;
            case "UV": return 7;
            case "UHV": return 8;
            case "UEV": return 9;
            case "UIV": return 10;
            case "UMV": return 11;
            case "UXV": return 12;
            case "MAX": return 13;
            default: return 0;
        }
    }

    // Maximum EU/t for each tier LV..MAX (index matches voltageTiers). MAX is clamped to int range.
    private static readonly long[] tierVoltageCaps =
    {
        32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152, 8388608, 33554432, 134217728, 536870912, 2147483647
    };

    public static int GetVoltageTierFromRaw(long voltage)
    {
        for (var tier = 0; tier < tierVoltageCaps.Length; tier++)
        {
            if (voltage <= tierVoltageCaps[tier])
                return tier;
        }
        return tierVoltageCaps.Length - 1;
    }
}