
var DEFAULT_LABEL_PROPS = ["nam_ja", "N03_004", "N03_007", "N03_001"];
var KEY_COLUMN = "市区町村"; // Assuming this is what it becomes
var currentMap = { labelProps: DEFAULT_LABEL_PROPS };

function getLabelFromProperties(properties, labelProps) {
    var props = properties || {};
    var candidates = (labelProps && labelProps.length ? labelProps : DEFAULT_LABEL_PROPS);
    for (var i = 0; i < candidates.length; i++) {
        var value = props[candidates[i]];
        if (value !== null && value !== undefined && value !== "") {
            return value;
        }
    }
    return null;
}

function getFeatureLabel(feature) {
    var props = feature && feature.properties;
    var labelProps = (currentMap && currentMap.labelProps) || DEFAULT_LABEL_PROPS;
    // CSVデータ（carto.features由来）の場合は KEY_COLUMN がプロパティのキーになっているため、候補に加える
    var candidates = labelProps.concat([KEY_COLUMN]);
    var label = getLabelFromProperties(props, candidates);
    return label || "";
}

// Case 1: Original Feature
var originalFeature = {
    properties: {
        "nam_ja": "Hokkaido",
        "N03_004": "Hokkaido"
    }
};

// Case 2: CSV Feature (Sample Data)
var csvFeature = {
    properties: {
        "市区町村": "Hokkaido",
        "Sample Value A": 100
    }
};

console.log("Original:", getFeatureLabel(originalFeature));
console.log("CSV:", getFeatureLabel(csvFeature));
