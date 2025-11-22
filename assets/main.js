// hide the form if the browser doesn't do SVG,
// (then just let everything else fail)
if (!document.createElementNS) {
  var fallbackForm = document.querySelector("form");
  if (fallbackForm) {
    fallbackForm.style.display = "none";
  }
}

var KEY_COLUMN = "都道府県",
  MAX_FILE_SIZE = 2 * 1024 * 1024,
  PREVIEW_ROW_COUNT = 6,
  CURRENT_PREVIEW_ROW_COUNT = 12,
  DEFAULT_COLOR_SCHEME_ID = "blues",
  DEFAULT_OBJECT_NAME = "japan",
  PREF_INDEX_URL = "data/prefectures/index.json";

var MAP_OPTIONS = [{
}];

var RANKING_SUFFIX = " ランキング";
var COLOR_SCHEME_GROUPS = [
  {
    label: "ColorBrewer",
    type: "sequential",
    schemes: [
      { id: "blues", name: "Blues", interpolator: d3.interpolateBlues },
      { id: "greens", name: "Greens", interpolator: d3.interpolateGreens },
      { id: "oranges", name: "Oranges", interpolator: d3.interpolateOranges },
      { id: "purples", name: "Purples", interpolator: d3.interpolatePurples },
      { id: "reds", name: "Reds", interpolator: d3.interpolateReds }
    ]
  },
  {
    label: "Matplotlib",
    type: "sequential",
    schemes: [
      { id: "viridis", name: "Viridis", interpolator: d3.interpolateViridis },
      { id: "inferno", name: "Inferno", interpolator: d3.interpolateInferno },
      { id: "magma", name: "Magma", interpolator: d3.interpolateMagma },
      { id: "plasma", name: "Plasma", interpolator: d3.interpolatePlasma },
      { id: "cividis", name: "Cividis", interpolator: d3.interpolateCividis },
      { id: "turbo", name: "Turbo", interpolator: d3.interpolateTurbo }
    ]
  },
  {
    label: "Diverging",
    type: "diverging",
    schemes: [
      { id: "rdbu", name: "Red-Blue", interpolator: d3.interpolateRdBu },
      { id: "prgn", name: "Purple-Green", interpolator: d3.interpolatePRGn },
      { id: "puor", name: "Purple-Orange", interpolator: d3.interpolatePuOr },
      { id: "piyg", name: "Pink-Yellow-Green", interpolator: d3.interpolatePiYG }
    ]
  }
];

var COLOR_SCHEMES = [];

// ラベルは自治体名（nam_ja / N03_004）を最優先で拾う。無い場合のフォールバックとしてコード列を使う。
var DEFAULT_LABEL_PROPS = ["nam_ja", "N03_004", "N03_007", "N03_001"];

function buildMapOptionIndex(options) {
  var map = d3.map();
  options.forEach(function (option) {
    map.set(option.id, option);
  });
  return map;
}

function transformPrefIndexToOptions(items) {
  return (items || []).map(function (item) {
    return {
      id: item.id,
      name: item.name,
      path: "data/prefectures/" + item.id + ".topojson",
      type: "topojson",
      objectName: "data",
      keyLabel: "市区町村",
      labelProps: ["nam_ja", "N03_004", "N03_007", "N03_001"]
    };
  });
}

function renderMapSelect(options) {
  var entries = mapSelect.selectAll("option")
    .data(options, function (d) { return d.id; });

  entries.exit().remove();

  entries.enter()
    .append("option")
    .merge(entries)
    .attr("value", function (d) { return d.id; })
    .text(function (d) { return d.name; });

  mapSelect.property("value", currentMap.id);
}

function setKeyColumn(name) {
  KEY_COLUMN = name || "地域名";
  mapKeyHint.text("キー列：" + KEY_COLUMN);
}

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

var fields = [],
  fieldsById = d3.map(),
  field = null,
  rawData,
  pendingDataset = null,
  originalData = null,
  mapOptionsById = d3.map(),
  currentMap = MAP_OPTIONS[0],
  isMapLoading = false,
  isInitialized = false,
  currentColorScheme = null,
  currentLegendCells = 5,
  legendUnit = "",
  legendUnitCache = "",
  currentMode = "value",
  currentLegendBoundaries = null;

var body = d3.select("body"),
  stat = d3.select("#status");

var mapSelect = d3.select("#map-select"),
  mapKeyHint = d3.select("#map-key-hint");

var fileInput = d3.select("#file-input"),
  dropzone = d3.select("#dropzone"),
  uploadStatus = d3.select("#upload-status"),
  preview = d3.select("#preview"),
  previewTable = d3.select("#preview-table"),
  sampleDataPreview = d3.select("#sample-data-preview"),
  previewStats = d3.select("#preview-stats"),
  applyButton = d3.select("#apply-data"),
  resetButton = d3.select("#reset-data"),
  currentDataLabel = d3.select("#current-data-label"),
  currentDataPreview = d3.select("#current-data-preview"),
  toggleCurrentPreviewButton = d3.select("#toggle-current-preview"),
  downloadSvgButton = d3.select("#download-svg-btn"),
  downloadPngButton = d3.select("#download-png-btn"),
  colorSchemeSelect = d3.select("#color-scheme"),
  legendCellsSelect = d3.select("#legend-cells"),
  legendUnitInput = d3.select("#legend-unit"),
  displayModeSelect = d3.select("#display-mode"),
  downloadDataButton = d3.select("#download-data-csv"),
  downloadSampleButton = d3.select("#download-sample");

var applyButtonDefaultText = applyButton.text(),
  applyButtonAppliedText = "適用済み";

var currentPreviewVisible = true,
  currentDatasetName = "サンプルデータ";

function resetFileInputValue() {
  var node = fileInput.node();
  if (!node) {
    return;
  }
  node.value = "";
  if (node.value) {
    node.type = "text";
    node.type = "file";
  }
}

function shouldBypassDropzoneClick(event) {
  if (!event || !event.target) {
    return false;
  }
  var target = event.target;
  if (target === fileInput.node()) {
    return true;
  }
  if (target.closest && target.closest(".file-input-label")) {
    return true;
  }
  return false;
}

function getVisibleColorGroups() {
  return COLOR_SCHEME_GROUPS.filter(function (group) {
    return currentMode === "ranking" ? group.type === "diverging" : group.type === "sequential";
  });
}

function initializeColorSchemeOptions() {
  colorSchemeSelect.selectAll("optgroup").remove();
  COLOR_SCHEMES = [];

  var groups = getVisibleColorGroups();
  groups.forEach(function (group) {
    var optgroup = colorSchemeSelect.append("optgroup")
      .attr("label", group.label);

    optgroup.selectAll("option")
      .data(group.schemes, function (d) { return d.id; })
      .enter()
      .append("option")
      .attr("value", function (d) { return d.id; })
      .text(function (d) { return d.name; });

    COLOR_SCHEMES = COLOR_SCHEMES.concat(group.schemes);
  });

  colorSchemeSelect.on("change", function () {
    setColorScheme(this.value);
  });

  var preferredScheme = getColorSchemeById(currentColorScheme && currentColorScheme.id) || getColorSchemeById(DEFAULT_COLOR_SCHEME_ID) || COLOR_SCHEMES[0];
  if (preferredScheme) {
    setColorScheme(preferredScheme.id, { silent: true });
  } else {
    currentColorScheme = null;
  }
}

function setColorScheme(id, options) {
  if (!COLOR_SCHEMES.length) {
    currentColorScheme = null;
    colorSchemeSelect.property("value", null);
    return;
  }
  var nextScheme = getColorSchemeById(id) || COLOR_SCHEMES[0];
  var hasChanged = !currentColorScheme || currentColorScheme.id !== nextScheme.id;
  currentColorScheme = nextScheme;
  colorSchemeSelect.property("value", currentColorScheme.id);
  if (hasChanged && (!options || !options.silent)) {
    if (field && field.id !== "none") {
      deferredUpdate();
    }
  }
}

function setDisplayMode(mode) {
  var nextMode = mode === "ranking" ? "ranking" : "value";
  if (currentMode === nextMode) {
    return;
  }
  displayModeSelect.property("value", nextMode);
  currentMode = nextMode;
  if (currentMode === "ranking") {
    legendUnitCache = legendUnit;
    legendUnit = "位";
    legendUnitInput
      .property("value", legendUnit)
      .property("disabled", true);
  } else {
    legendUnit = legendUnitCache || "";
    legendUnitInput
      .property("value", legendUnit)
      .property("disabled", false);
  }
  initializeColorSchemeOptions();
  updateLegendCellsOptions();
  if (field && field.id !== "none") {
    deferredUpdate();
  }
}

function getColorSchemeById(id) {
  if (!id) {
    return null;
  }
  for (var i = 0; i < COLOR_SCHEMES.length; i++) {
    if (COLOR_SCHEMES[i].id === id) {
      return COLOR_SCHEMES[i];
    }
  }
  return null;
}

var fieldSelect = d3.select("#field")
  .on("change", function () {
    var selectedId = this.value;
    var nextField = fieldsById.get(selectedId) || fields[this.selectedIndex] || fields[0];
    field = nextField;
    if (field && field.id !== "none") {
      legendCellsSelect.property("disabled", false);
      colorSchemeSelect.property("disabled", false);
      displayModeSelect.property("disabled", false);
      initializeColorSchemeOptions();
    }
    updateFieldSelection();
  });

displayModeSelect.on("change", function () {
  setDisplayMode(this.value);
});

setDisplayMode(currentMode);

legendCellsSelect.on("change", function () {
  currentLegendCells = +this.value;
  if (field && field.id !== "none") {
    deferredUpdate();
  }
});

legendUnitInput.on("input", function () {
  legendUnit = (this.value || "").trim();
  if (currentMode === "value") {
    legendUnitCache = legendUnit;
  }
  if (field && field.id !== "none") {
    deferredUpdate();
  }
});

function updateLegendCellsOptions() {
  var isRanking = currentMode === "ranking";
  var oddDefault = null;
  legendCellsSelect.selectAll("option").each(function () {
    var option = d3.select(this);
    var value = +option.attr("value");
    var isOdd = value % 2 === 1;
    if (isRanking && !isOdd) {
      option.attr("disabled", true);
    } else {
      option.attr("disabled", null);
    }
    if (isOdd && oddDefault === null) {
      oddDefault = value;
    }
  });
  if (isRanking) {
    var currentValue = +legendCellsSelect.property("value");
    if (currentValue % 2 === 0) {
      legendCellsSelect.property("value", oddDefault || 3);
      currentLegendCells = +legendCellsSelect.property("value");
      if (field && field.id !== "none") {
        deferredUpdate();
      }
    }
  }
}

applyButton.property("disabled", true);
applyButton.text(applyButtonDefaultText);
setCurrentDataPreviewDefault();
setUploadStatus("CSV ファイル（UTF-8）をアップロードしてカルトグラムをカスタマイズできます。", "info");

fileInput.on("change", function () {
  var file = this.files && this.files[0];
  if (file) {
    handleFileUpload(file);
  }
  resetFileInputValue();
});

dropzone
  .on("dragover", function () {
    d3.event.preventDefault();
    dropzone.classed("dragover", true);
  })
  .on("dragleave", function () {
    dropzone.classed("dragover", false);
  })
  .on("drop", function () {
    d3.event.preventDefault();
    dropzone.classed("dragover", false);
    var event = d3.event;
    var file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if (file) {
      handleFileUpload(file);
    }
  })
  .on("click", function () {
    var event = d3.event;
    if (shouldBypassDropzoneClick(event)) {
      return;
    }
    fileInput.node().click();
  });

toggleCurrentPreviewButton.on("click", function () {
  currentPreviewVisible = !currentPreviewVisible;
  toggleCurrentPreviewButton.text(currentPreviewVisible ? "表データを隠す" : "表データを表示");
  currentDataPreview.classed("is-hidden", !currentPreviewVisible);
  if (currentPreviewVisible) {
    renderCurrentDataPreview();
  }
});

downloadSvgButton.on("click", downloadCurrentSvg);
downloadPngButton.on("click", downloadCurrentPng);
downloadDataButton.on("click", downloadCurrentDatasetCsv);
downloadSampleButton.on("click", downloadSampleDataset);

applyButton.on("click", applyPendingData);
resetButton.on("click", resetToSampleData);


var map = d3.select("#map"),
  layer = map.append("g")
    .attr("id", "layer"),
  states = layer.append("g")
    .attr("id", "states")
    .selectAll("path"),
  legendGroup = map.append("g")
    .attr("id", "legend")
    .attr("transform", "translate(520, 660)");


var proj = d3.geoMercator()
  .center([138, 36])
  .scale(1450)
  .translate([400, 400]),
  topology,
  geometries,
  dataById = d3.map(),
  carto = d3.cartogram()
    .projection(proj)
    .properties(function (d) {
      return dataById.get(getFeatureLabel(d)) || {};
    })
    .value(function (d) {
      return field && field.key ? +d.properties[field.key] : 1;
    });

function loadMapOptions() {
  d3.json(PREF_INDEX_URL, function (error, data) {
    var prefOptions = (!error && data && data.length) ? transformPrefIndexToOptions(data) : [];
    MAP_OPTIONS = prefOptions;
    mapOptionsById = buildMapOptionIndex(MAP_OPTIONS);
    renderMapSelect(MAP_OPTIONS);
    mapSelect.on("change", function () {
      changeMap(this.value);
    });
    changeMap(currentMap.id, { silent: true });
  });
}

function changeMap(mapId, options) {
  options = options || {};
  if (isMapLoading) {
    return;
  }
  var nextMap = mapOptionsById && mapOptionsById.get(mapId);
  if (!nextMap && MAP_OPTIONS.length) {
    nextMap = MAP_OPTIONS[0];
  }
  currentMap = nextMap;
  mapSelect.property("value", currentMap.id);
  setKeyColumn(currentMap.keyLabel || "地域名");
  stat.text("地図を読み込み中...").classed("empty", false);
  isMapLoading = true;

  fetchTopologyForMap(currentMap, function (err, result) {
    isMapLoading = false;
    if (err || !result) {
      console.error(err || new Error("topology missing"));
      stat.text("地図の読み込みに失敗しました。").classed("empty", false);
      return;
    }
    topology = result.topology;
    geometries = result.geometries;
    currentMap.objectName = result.objectName || currentMap.objectName;

    updateProjectionForCurrentTopology();
    applySampleDatasetForCurrentMap(options);
  });
}

function fetchTopologyForMap(option, callback) {
  d3.json(option.path, function (error, data) {
    if (error || !data) {
      callback(error || new Error("データが読み込めません。"));
      return;
    }
    var topo = data;
    var objectName = option.objectName || DEFAULT_OBJECT_NAME;
    if (option.type === "geojson") {
      topo = topojson.topology({ pref: data }, 1e5);
      objectName = "pref";
    }
    if (!topo.objects || !topo.objects[objectName]) {
      objectName = topo.objects ? Object.keys(topo.objects)[0] : null;
    }
    var obj = objectName && topo.objects ? topo.objects[objectName] : null;
    var geoms = obj && obj.geometries ? obj.geometries : null;
    if (!geoms) {
      callback(new Error("地図ジオメトリが見つかりません。"));
      return;
    }
    callback(null, {
      topology: topo,
      geometries: geoms,
      objectName: objectName
    });
  });
}

function updateProjectionForCurrentTopology() {
  if (!(topology && geometries)) {
    return;
  }
  var featureCollection = topojson.feature(topology, {
    type: "GeometryCollection",
    geometries: geometries
  });
  var nextProj = d3.geoMercator();
  if (featureCollection && featureCollection.features && featureCollection.features.length) {
    nextProj.fitExtent([[40, 40], [760, 760]], featureCollection);
  } else {
    nextProj
      .center([138, 36])
      .scale(1450)
      .translate([400, 400]);
  }
  proj = nextProj;
  carto.projection(proj);
}

function redrawMapBase() {
  if (!(topology && geometries)) {
    return;
  }
  var features = carto.features(topology, geometries),
    path = d3.geoPath()
      .projection(proj);

  states = states.data(features, function (d) {
    return getFeatureLabel(d);
  });

  states.exit().remove();

  var stateEnter = states.enter()
    .append("path")
    .attr("class", "state")
    .attr("fill", "#fafafa");

  stateEnter.append("title");

  states = stateEnter.merge(states)
    .attr("id", function (d) {
      return slugify(getFeatureLabel(d));
    })
    .attr("d", path)
    .attr("fill", "#fafafa");

  states.select("title")
    .text(function (d) {
      return getFeatureLabel(d);
    });
}

function getCurrentFeatureLabels() {
  if (!(topology && geometries)) {
    return [];
  }
  var features = topojson.feature(topology, {
    type: "GeometryCollection",
    geometries: geometries
  }).features || [];
  var seen = d3.map();
  var labels = [];
  features.forEach(function (f) {
    var label = getFeatureLabel(f);
    if (label && !seen.get(label)) {
      seen.set(label, true);
      labels.push(label);
    }
  });
  return labels;
}

function generateSampleDataset(labels) {
  labels = labels || [];
  var base = [];
  labels.forEach(function (label, index) {
    var seed = index + 1;
    var valueA = 100 + (seed * 13 % 900);
    var valueB = 50 + (seed * 17 % 700);
    base.push((function () {
      var row = {};
      row[KEY_COLUMN] = label;
      row["サンプル値A"] = valueA;
      row["サンプル値B"] = valueB;
      return row;
    })());
  });
  return base;
}

function applySampleDatasetForCurrentMap(options) {
  options = options || {};
  redrawMapBase(); // ensure features are bound before extracting labels

  fetchPrefectureSample(function (err, dataset) {
    var labels;
    var isFromFile = false;
    if (!err && dataset && dataset.length) {
      isFromFile = true;
      labels = dataset.map(function (row) { return row[KEY_COLUMN]; }).filter(Boolean);
    } else {
      labels = getCurrentFeatureLabels();
      if (!labels.length) {
        stat.text("地図データから地名を取得できませんでした。").classed("empty", false);
        return;
      }
      dataset = generateSampleDataset(labels);
    }

    originalData = cloneDataset(dataset);
    pendingDataset = null;
    isInitialized = true;

    loadDataset(cloneDataset(dataset), {
      deferRender: false,
      label: currentMap.name + " サンプルデータ",
      isSample: true,
      defaultToNone: true,
      preserveField: false
    });

    redrawMapBase(); // inject dataset into feature properties
    clearPreview();
    setCurrentDataPreviewDefault();
    renderSampleDataPreview(rawData, currentMap.name + " サンプルデータ");
    if (!options.silent) {
      var note = isFromFile ? "地図用サンプルCSVを読み込みました。" : "地図に合わせてサンプルを生成しました。";
      stat.text(note).classed("empty", true);
    } else {
      stat.text("").classed("empty", true);
    }
  });
}

function fetchPrefectureSample(callback) {
  var csvPath = "data/theme/" + currentMap.id + ".csv";
  d3.csv(csvPath, function (error, data) {
    if (error || !data || !data.length) {
      return callback(error || new Error("csv not found"));
    }
    callback(null, data);
  });
}

function init() {
  var features = carto.features(topology, geometries),
    path = d3.geoPath()
      .projection(proj);

  states = states.data(features)
    .enter()
    .append("path")
    .attr("class", "state")
    .attr("id", function (d) {
      return getFeatureLabel(d);
    })
    .attr("fill", "#fafafa")
    .attr("d", path);

  states.append("title");

  updateFieldSelection();
  isInitialized = true;
}

function reset() {
  stat.text("");
  stat.classed("empty", true);
  body.classed("updating", false);
  clearLegend();

  // 指標未選択時は変形しない素の形状を描画する
  // 指標未選択時は変形しない素の形状を描画する
  carto.value(function () { return 1; });

  var features = carto.features(topology, geometries),
    path = d3.geoPath()
      .projection(proj);

  states.data(features)
    .transition()
    .duration(750)
    .ease(d3.easeLinear)
    .attr("fill", "#fafafa")
    .attr("d", path);

  states.select("title")
    .text(function (d) {
      return getFeatureLabel(d);
    });
}

function update() {

  var start = Date.now();
  body.classed("updating", true);

  // 指標未選択の場合は変形も着色もしない白地図に戻す
  if (!field || field.id === "none") {
    reset();
    return;
  }

  var key = field.key,
    fmt = d3.format(","),
    value = function (d) {
      var label = getFeatureLabel(d);
      var row = (dataById && label) ? dataById.get(label) : null;
      var fromDataMap = row && row[key];
      var fromProps = d && d.properties ? d.properties[key] : null;
      var v = (fromDataMap !== undefined && fromDataMap !== null && fromDataMap !== "") ? fromDataMap : fromProps;
      return v === undefined || v === null || v === "" ? NaN : +v;
    };

  // 値集合は原データ優先で集計し、無ければ地物から拾う
  var values = (rawData || [])
    .map(function (row) { return row ? +row[key] : NaN; })
    .filter(function (n) { return !isNaN(n); });

  if (!values.length) {
    values = states.data()
      .map(value)
      .filter(function (n) {
        return !isNaN(n);
      });
  }

  values = values.sort(d3.ascending);

  if (!values.length) {
    stat.text("有効な数値が見つかりません。");
    body.classed("updating", false);
    return;
  }

  var lo = values[0],
    hi = values[values.length - 1];

  var colorInterpolator = (currentColorScheme && currentColorScheme.interpolator) || d3.interpolateBlues;
  var legendMin = lo;
  var legendMax = hi;
  var color;

  if (currentMode === "ranking") {
    var totalRanks = values.length;
    legendMin = 1;
    legendMax = Math.max(1, totalRanks);
    var steps = Math.max(3, currentLegendCells);
    var colorRange = buildColorSamples(colorInterpolator, steps);
    color = d3.scaleQuantize()
      .domain([legendMin, legendMax])
      .range(colorRange);
    currentLegendBoundaries = null;
  } else {
    var colorSteps = Math.max(1, currentLegendCells);
    var colorRange = buildColorSamples(colorInterpolator, colorSteps);
    color = d3.scaleQuantize()
      .domain([lo, hi])
      .range(colorRange);
    currentLegendBoundaries = null;
  }

  // normalize the scale to positive numbers
  var scale = d3.scaleLinear()
    .domain([lo, hi])
    .range([1, 1000]);

  // tell the cartogram to use the scaled values
  carto.value(function (d) {
    var currentValue = value(d);
    if (isNaN(currentValue)) {
      return 1;
    }
    return scale(currentValue);
  });

  // generate the new features, pre-projected
  var features = carto(topology, geometries).features;

  // キー付きでパスを再バインド（ラベルをキーにする）
  var joined = states.data(features, function (d) {
    return getFeatureLabel(d);
  });

  var entered = joined.enter()
    .append("path")
    .attr("class", "state")
    .attr("fill", "#fafafa");

  // title 要素を確保
  entered.append("title");

  // enter + update をマージ
  joined = entered.merge(joined);

  // title 更新
  joined.select("title")
    .text(function (d) {
      var originalValue = value(d);
      var displayValue = isNaN(originalValue) ? "データなし" : fmt(originalValue);
      return [getFeatureLabel(d), displayValue].join(": ");
    });

  joined.transition()
    .duration(750)
    .ease(d3.easeLinear)
    .attr("fill", function (d) {
      var rawValue = value(d);
      var colorValue = currentMode === "ranking" ? getRankingValue(d) : rawValue;
      return isNaN(colorValue) ? "#f0f0f0" : color(colorValue);
    })
    .attr("d", carto.path);

  // 最新の selection を保持
  states = joined;

  renderLegend(color, legendMin, legendMax, currentLegendBoundaries);

  var delta = (Date.now() - start) / 1000;
  stat.text(["calculated in", delta.toFixed(1), "seconds"].join(" "));
  stat.classed("empty", false);
  body.classed("updating", false);
}

function buildColorSamples(interpolator, steps) {
  var normalizedSteps = Math.max(1, steps || 1);
  if (normalizedSteps === 1) {
    return [interpolator(0.5)];
  }
  var samples = [];
  for (var i = 0; i < normalizedSteps; i++) {
    samples.push(interpolator(i / (normalizedSteps - 1)));
  }
  return samples;
}

function buildRankingDomain(minRank, centerRank, maxRank, steps) {
  if (steps <= 0) {
    return [];
  }
  var domain = [];
  if (steps === 1) {
    domain.push(centerRank);
    return domain;
  }
  var centerIndex = Math.floor((steps - 1) / 2);
  var centerRatio = centerIndex / (steps - 1);

  for (var i = 0; i < steps; i++) {
    var t = i / (steps - 1);
    var value;
    if (t <= centerRatio) {
      var ratio = centerRatio === 0 ? 0 : t / centerRatio;
      value = minRank + (centerRank - minRank) * ratio;
    } else {
      var ratio = centerRatio === 1 ? 0 : (t - centerRatio) / (1 - centerRatio);
      value = centerRank + (maxRank - centerRank) * ratio;
    }
    domain.push(value);
  }
  return domain;
}

function getRankingColumnKey(column) {
  return column + RANKING_SUFFIX;
}

function getRankingValue(feature) {
  if (!feature || !field || !field.key) {
    return NaN;
  }

  var label = getFeatureLabel(feature);
  var row = (dataById && label) ? dataById.get(label) : null;
  var props = (feature && feature.properties) || {};
  var value = row ? row[getRankingColumnKey(field.key)] : props[getRankingColumnKey(field.key)];

  if (value === undefined || value === null || value === "") {
    return NaN;
  }
  return +value;
}

var deferredUpdate = (function () {
  var timeout;
  return function () {
    var args = arguments;
    clearTimeout(timeout);
    stat.text("calculating...");
    return timeout = setTimeout(function () {
      update.apply(null, arguments);
    }, 10);
  };
})();

function updateFieldSelection() {
  if (!field) {
    return;
  }

  if (fields.length) {
    fieldSelect.property("selectedIndex", Math.max(fields.indexOf(field), 0));
  }

  var isNoField = field.id === "none";
  colorSchemeSelect.property("disabled", isNoField);
  legendCellsSelect.property("disabled", isNoField);
  displayModeSelect.property("disabled", isNoField);

  if (isNoField) {
    reset();
  } else {
    deferredUpdate();
  }

}

function loadDataset(data, options) {
  options = options || {};
  var dataset = data || [];
  augmentWithRankings(dataset);
  rawData = dataset;
  dataById = buildDataIndex(rawData);
  // マップ側のジオメトリに最新データを反映させる
  applyDataToGeometries();
  syncDataIntoStates();


  var nextFields = buildFieldsFromData(rawData);
  fields = nextFields;
  fieldsById = buildFieldIndex(nextFields);

  var preferredKey = options.forceFieldKey || ((options.preserveField === false) ? null : (field && field.key));
  field = selectDefaultField(nextFields, preferredKey, options.defaultToNone);

  refreshFieldOptions();
  updateCurrentDatasetLabel(options.label || "カスタムデータ", options.isSample);
  renderCurrentDataPreview();
  renderSampleDataPreview(rawData, options.label || currentDatasetName);

  stat.text("");
  stat.classed("empty", true);

  if (field && isInitialized && !options.deferRender) {
    updateFieldSelection();
  } else if (field && !options.deferRender) {
    // 初回初期化前でも描画を走らせる
    updateFieldSelection();
  }
}

function buildFieldsFromData(data) {
  var availableFields = [{
    name: "(指標未適用)",
    id: "none"
  }];

  if (!data || !data.length) {
    return availableFields;
  }

  var numericColumns = getNumericColumns(data);

  numericColumns.forEach(function (header, index) {
    var baseId = header.toLowerCase().replace(/[^a-z0-9]/g, "_") || ("field_" + index);
    var uniqueId = baseId + "_" + index;
    availableFields.push({
      name: header,
      id: uniqueId,
      key: header
    });
  });

  return availableFields;
}

function buildFieldIndex(items) {
  var map = d3.map();
  items.forEach(function (item) {
    map.set(item.id, item);
  });
  return map;
}

function buildDataIndex(data) {
  var map = d3.map();
  (data || []).forEach(function (row) {
    var key = row && row[KEY_COLUMN];
    if (key !== undefined && key !== null && key !== "") {
      map.set(key, row);
    }
  });
  return map;
}

function applyDataToGeometries() {
  if (!geometries || !geometries.length || !dataById || !dataById.size()) {
    return;
  }
  geometries.forEach(function (geom) {
    if (!geom || !geom.properties) {
      return;
    }
    var label = getFeatureLabel({ properties: geom.properties }) || geom.properties[KEY_COLUMN];
    var row = label ? dataById.get(label) : null;
    if (row) {
      // 既存プロパティを保ちつつデータ行をマージ
      geom.properties = Object.assign({}, geom.properties, row);
    }
  });
}

// 既にバインド済みの state データにも最新の行データをマージする
function syncDataIntoStates() {
  if (!states || !dataById || !dataById.size()) {
    return;
  }
  states.each(function (d) {
    var label = getFeatureLabel(d);
    var row = label ? dataById.get(label) : null;
    if (row && d && d.properties) {
      d.properties = Object.assign({}, d.properties, row);
    }
  });
}

function refreshFieldOptions() {
  var options = fieldSelect.selectAll("option")
    .data(fields, function (d) { return d.id; });

  options.exit().remove();

  options.enter()
    .append("option")
    .merge(options)
    .attr("value", function (d) { return d.id; })
    .text(function (d) { return d.name; });

  if (fields.length) {
    fieldSelect.property("selectedIndex", Math.max(fields.indexOf(field), 0));
  }
}

function getFieldStats(data, key) {
  if (!data || !data.length || !key) {
    return { min: null, max: null, distinct: 0 };
  }
  var values = data
    .map(function (row) { return row ? +row[key] : NaN; })
    .filter(function (n) { return !isNaN(n); });
  var distinct = d3.set(values).values().length;
  return {
    min: values.length ? d3.min(values) : null,
    max: values.length ? d3.max(values) : null,
    distinct: distinct
  };
}

function getNumericColumns(data) {
  if (!data || !data.length) {
    return [];
  }

  var headers = Object.keys(data[0]).filter(function (header) {
    return header !== KEY_COLUMN && !hasRankingSuffix(header);
  });

  return headers.filter(function (header) {
    return data.some(function (row) {
      var value = row[header];
      return value !== undefined && value !== null && value !== "" && !isNaN(+value);
    });
  });
}

function hasRankingSuffix(header) {
  if (!header) {
    return false;
  }
  return header.slice(-RANKING_SUFFIX.length) === RANKING_SUFFIX;
}

function handleFileUpload(file) {
  if (!file) {
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    setUploadStatus("ファイルサイズが大きすぎます（2MB以下にしてください）。", "danger");
    return;
  }

  setUploadStatus("「" + file.name + "」を読み込み中...", "info");

  var reader = new FileReader();
  reader.onload = function (evt) {
    try {
      var text = (evt.target.result || "").trim();
      var parsed = d3.csvParse(text);
      preparePreview(parsed, file.name);
    } catch (error) {
      console.error(error);
      setUploadStatus("CSV の解析に失敗しました。ファイル内容を確認してください。", "danger");
      clearPreview();
    }
  };

  reader.onerror = function () {
    setUploadStatus("ファイルの読み込みに失敗しました。", "danger");
    clearPreview();
  };

  reader.readAsText(file, "utf-8");
}


function preparePreview(data, filename) {
  var label = filename || "アップロードしたファイル";
  var validation = validateDataset(data);

  if (!validation.valid) {
    setUploadStatus(validation.message, "danger");
    clearPreview();
    return;
  }

  augmentWithRankings(data);

  pendingDataset = {
    data: data,
    filename: label,
    numericColumns: validation.numericColumns
  };

  preview.classed("is-hidden", false);
  renderPreviewTable(data);
  renderPreviewStats(data, validation.numericColumns);
  setUploadStatus("「" + label + "」を読み込みました。プレビューを確認して適用してください。", "success");
  applyButton
    .property("disabled", false)
    .text(applyButtonDefaultText);
}

function validateDataset(data) {
  if (!data || !data.length) {
    return { valid: false, message: "データ行が見つかりませんでした。" };
  }

  var headers = Object.keys(data[0]);
  if (headers.indexOf(KEY_COLUMN) === -1) {
    return { valid: false, message: "CSV に「" + KEY_COLUMN + "」列が含まれていません。" };
  }

  var numericColumns = getNumericColumns(data);
  if (!numericColumns.length) {
    return { valid: false, message: "数値として扱える列がありません。" };
  }

  return {
    valid: true,
    numericColumns: numericColumns
  };
}

function clearPreview() {
  pendingDataset = null;
  preview.classed("is-hidden", true);
  previewTable.html("<p class='text-muted'>CSV をアップロードするとここにプレビューが表示されます。</p>");
  previewStats.html("");
  applyButton
    .property("disabled", true)
    .text(applyButtonDefaultText);
}

function renderPreviewTable(data) {
  renderTableInto(previewTable, data, {
    rowCount: PREVIEW_ROW_COUNT,
    emptyMessage: "プレビューできる行がありません。",
    note: function (shownRows, totalRows) {
      return "先頭 " + shownRows + " 行を表示しています（全 " + totalRows + " 行）。";
    }
  });
}

function renderPreviewStats(data, numericColumns) {
  if (!numericColumns || !numericColumns.length) {
    previewStats.html("");
    return;
  }

  var fmt = d3.format(",.2f");

  var statsHtml = numericColumns.map(function (column) {
    var values = data
      .map(function (row) { return +row[column]; })
      .filter(function (value) { return !isNaN(value); });

    var min = d3.min(values);
    var max = d3.max(values);
    var mean = d3.mean(values);

    return "<p><strong>" + column + "</strong>：最小 " + fmt(min) + " ／ 最大 " + fmt(max) + " ／ 平均 " + fmt(mean) + "</p>";
  }).join("");

  previewStats.html(statsHtml);
}

function setUploadStatus(message, tone) {
  var classes = ["help-text"];
  if (tone) {
    classes.push("tone-" + tone);
  }
  uploadStatus
    .attr("class", classes.join(" "))
    .text(message || "");
}

function renderTableInto(container, data, options) {
  options = options || {};
  if (!data || !data.length) {
    container.html("<p class='text-muted'>" + (options.emptyMessage || "表示できるデータがありません。") + "</p>");
    return;
  }

  var headers = Object.keys(data[0]);
  var rowCount = Math.min(options.rowCount || data.length, data.length);
  var rows = data.slice(0, rowCount);

  var headerHtml = headers.map(function (header) {
    return "<th>" + header + "</th>";
  }).join("");

  var rowsHtml = rows.map(function (row) {
    var cells = headers.map(function (header) {
      var value = row[header];
      return "<td>" + (value !== undefined ? value : "") + "</td>";
    }).join("");
    return "<tr>" + cells + "</tr>";
  }).join("");

  var note;
  if (typeof options.note === "function") {
    note = options.note(rowCount, data.length);
  } else {
    note = options.note || "先頭 " + rowCount + " 行を表示しています。";
  }

  var tableHtml = ""
    + "<table class='data-table'>"
    + "<thead><tr>" + headerHtml + "</tr></thead>"
    + "<tbody>" + rowsHtml + "</tbody>"
    + "</table>"
    + "<p class='text-muted small-text'>" + note + "</p>";

  container.html(tableHtml);
}

function renderCurrentDataPreview() {
  if (!rawData || !rawData.length) {
    currentDataPreview
      .classed("is-hidden", !currentPreviewVisible)
      .html("<p class='text-muted'>現在のデータが読み込まれていません。</p>");
    renderSampleDataPreview(null, currentDatasetName);
    return;
  }

  renderTableInto(currentDataPreview, rawData, {
    rowCount: CURRENT_PREVIEW_ROW_COUNT,
    emptyMessage: "現在のデータが読み込まれていません。",
    note: function (shownRows, totalRows) {
      return "先頭 " + shownRows + " 行（" + currentDatasetName + " ／ 全 " + totalRows + " 行）を表示しています。";
    }
  });

  renderSampleDataPreview(rawData, currentDatasetName);
}

function renderSampleDataPreview(data, datasetLabel) {
  if (!data || !data.length) {
    sampleDataPreview.html("<p class='text-muted'>サンプルデータがありません。</p>");
    return;
  }

  renderTableInto(sampleDataPreview, data, {
    rowCount: PREVIEW_ROW_COUNT,
    emptyMessage: "サンプルデータがありません。",
    note: function (shownRows, totalRows) {
      var name = datasetLabel || currentDatasetName || "サンプルデータ";
      return "先頭 " + shownRows + " 行（" + name + " ／ 全 " + totalRows + " 行）を表示しています。";
    }
  });
}

function updateCurrentDatasetLabel(label, isSample) {
  currentDatasetName = label;
  var tagClass = "status-value " + (isSample ? "is-sample" : "is-custom");
  currentDataLabel
    .attr("class", tagClass)
    .text(label);
}

function setCurrentDataPreviewDefault() {
  currentPreviewVisible = true;
  toggleCurrentPreviewButton.text("表データを隠す");
  currentDataPreview
    .classed("is-hidden", false);
  renderCurrentDataPreview();
}

function applyPendingData() {
  if (!pendingDataset) {
    setUploadStatus("適用できるプレビューがありません。新しい CSV をアップロードしてください。", "danger");
    return;
  }

  var datasetLabel = pendingDataset.filename || "アップロードデータ";

  loadDataset(cloneDataset(pendingDataset.data), {
    label: datasetLabel,
    isSample: false,
    preserveField: false,
    defaultToNone: true
  });
  resetMapVisualState();

  setUploadStatus("「" + datasetLabel + "」を適用しました。", "success");

  clearPreview();
  previewTable.html("<p class='text-success'>アップロードしたデータを適用しました。別のファイルを読み込むこともできます。</p>");
  applyButton.text(applyButtonAppliedText);
  currentPreviewVisible = false;
  toggleCurrentPreviewButton.text("表データを表示");
  currentDataPreview.classed("is-hidden", true);
}

function resetToSampleData() {
  if (!originalData || !originalData.length) {
    setUploadStatus("サンプルデータを読み込めません。ページを再読み込みしてください。", "danger");
    return;
  }

  loadDataset(cloneDataset(originalData), {
    label: (currentMap && currentMap.name ? currentMap.name + " " : "") + "サンプルデータ",
    isSample: true,
    defaultToNone: true,
    preserveField: false
  });
  resetMapVisualState();
  clearPreview();
  previewTable.html("<p class='text-muted'>サンプルデータを表示しています。CSV をアップロードするとここにプレビューが表示されます。</p>");
  setUploadStatus("サンプルデータに戻しました。", "info");
}

function cloneDataset(data) {
  return (data || []).map(function (row) {
    var copy = {};
    Object.keys(row).forEach(function (key) {
      copy[key] = row[key];
    });
    return copy;
  });
}

function downloadCurrentSvg() {
  var svgNode = document.getElementById("map");
  if (!svgNode) {
    console.warn("SVG が見つかりません。");
    return;
  }

  var serialized = serializeSvg(svgNode);
  var blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, getDownloadFilename("svg"));
}

function downloadCurrentPng() {
  var svgNode = document.getElementById("map");
  if (!svgNode) {
    console.warn("SVG が見つかりません。");
    return;
  }

  setButtonLoading(downloadPngButton, true);

  var serialized = serializeSvg(svgNode);
  var dims = extractSvgDimensions(svgNode);
  var svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  var url = URL.createObjectURL(svgBlob);
  var image = new Image();
  image.onload = function () {
    var canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob(function (blob) {
      if (blob) {
        triggerDownload(blob, getDownloadFilename("png"));
      }
      setButtonLoading(downloadPngButton, false);
    }, "image/png");
  };
  image.onerror = function (error) {
    console.error("PNG 生成中にエラーが発生しました。", error);
    URL.revokeObjectURL(url);
    setButtonLoading(downloadPngButton, false);
  };
  image.src = url;
}

function downloadCurrentDatasetCsv() {
  if (!rawData || !rawData.length) {
    setUploadStatus("ダウンロードできるデータがありません。", "danger");
    return;
  }
  try {
    var csvContent = d3.csvFormat(rawData);
    var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, getDownloadFilename("csv"));
    setUploadStatus("CSV をダウンロードしました。", "success");
  } catch (error) {
    console.error(error);
    setUploadStatus("CSV の生成に失敗しました。", "danger");
  }
}

function downloadSampleDataset() {
  if (!originalData || !originalData.length) {
    setUploadStatus("サンプルデータがありません。", "danger");
    return;
  }
  try {
    var csvContent = d3.csvFormat(originalData);
    var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    var filename = slugify(currentMap && currentMap.name ? currentMap.name : "sample");
    triggerDownload(blob, (filename || "sample") + ".csv");
    setUploadStatus("サンプルCSV をダウンロードしました。", "success");
  } catch (error) {
    console.error(error);
    setUploadStatus("サンプルCSV の生成に失敗しました。", "danger");
  }
}

function serializeSvg(svgNode) {
  var clone = svgNode.cloneNode(true);
  var dims = extractSvgDimensions(svgNode);
  var viewBox = svgNode.getAttribute("viewBox");
  clone.setAttribute("width", dims.width);
  clone.setAttribute("height", dims.height);
  if (!viewBox) {
    clone.setAttribute("viewBox", "0 0 " + dims.width + " " + dims.height);
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  var style = document.createElement("style");
  style.setAttribute("type", "text/css");
  style.textContent = ""
    + "path.state{stroke:#666;stroke-width:.5;}"
    + "#legend .legend-title{font-size:12px;font-weight:600;fill:#0f172a;}"
    + "#legend text{font-size:11px;fill:#5f6c80;}";
  clone.insertBefore(style, clone.firstChild);

  var background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#ffffff");
  clone.insertBefore(background, style.nextSibling);

  var serializer = new XMLSerializer();
  return '<?xml version="1.0" encoding="UTF-8"?>' + serializer.serializeToString(clone);
}

function extractSvgDimensions(svgNode) {
  var bbox = svgNode.getBoundingClientRect();
  var width = bbox && bbox.width ? bbox.width : null;
  var height = bbox && bbox.height ? bbox.height : null;

  if (!(width && height)) {
    width = parseFloat(svgNode.getAttribute("width"));
    height = parseFloat(svgNode.getAttribute("height"));
  }

  if (!(width && height)) {
    var viewBox = svgNode.getAttribute("viewBox");
    if (viewBox) {
      var parts = viewBox.split(/\s+/);
      if (parts.length === 4) {
        width = parseFloat(parts[2]);
        height = parseFloat(parts[3]);
      }
    }
  }

  if (!(width && height)) {
    var bbox = svgNode.getBoundingClientRect();
    width = bbox.width;
    height = bbox.height;
  }

  return {
    width: Math.max(1, Math.round(width || 800)),
    height: Math.max(1, Math.round(height || 600))
  };
}

function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getDownloadFilename(ext) {
  var parts = ["japan-cartogram"];
  if (currentDatasetName) {
    parts.push(slugify(currentDatasetName));
  }
  if (field && field.name && field.id !== "none") {
    parts.push(slugify(field.name));
  }
  var base = parts.filter(Boolean).join("-");
  return base + "." + ext;
}

function slugify(value) {
  if (!value) {
    return "";
  }
  return value.toString()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^0-9A-Za-z\u3000-\u30FF\u4E00-\u9FFF_-]/g, "")
    .replace(/-+/g, "-");
}

function setButtonLoading(buttonSelection, isLoading) {
  buttonSelection
    .classed("is-loading", isLoading)
    .property("disabled", isLoading);
}

function resetMapVisualState() {
  if (!isInitialized) {
    return;
  }
  reset();
}


function renderLegend(colorScale, minValue, maxValue, legendBoundaries) {
  if (!legendGroup || typeof d3.legendColor !== "function" || !colorScale) {
    return;
  }

  var legendFieldName = (field && field.name && field.id !== "none") ? field.name : "値";
  var formatValue = d3.format(",.0f");
  function formatValueText(value) {
    return formatValue(value);
  }

  legendGroup.selectAll("*").remove();

  var legendContent = legendGroup.append("g")
    .attr("class", "legend-content");

  var unitLabel = currentMode === "ranking" ? "位" : (legendUnit || "");
  var rangeText = formatValueText(minValue) + " ～ " + formatValueText(maxValue);
  var titleSuffix = unitLabel ? " " + unitLabel : "";
  legendContent.append("text")
    .attr("class", "legend-title")
    .attr("x", 0)
    .attr("y", 0)
    .text(legendFieldName + "（" + rangeText + titleSuffix + "）");

  var barOffsetTop = 20;
  var labelOffset = 18;
  var labelBaseY = barOffsetTop + labelOffset;
  var legend = d3.legendColor()
    .shapeWidth(36)
    .shapeHeight(12)
    .labelFormat(formatValue)
    .orient("horizontal")
    .cells(currentLegendCells)
    .scale(colorScale);

  var legendScaleGroup = legendContent.append("g")
    .attr("class", "legend-scale")
    .attr("transform", "translate(0," + barOffsetTop + ")")
    .call(legend);

  legendScaleGroup.selectAll("rect.swatch")
    .attr("stroke", "#cccccc")
    .attr("stroke-width", 1)
    .attr("shape-rendering", "crispEdges");

  var legendCells = legendScaleGroup.selectAll(".cell");
  legendCells.select("text").remove();

  var legendExtents = getLegendExtents(colorScale, minValue, maxValue, legendBoundaries);
  legendCells.each(function (d, i) {
    var cell = d3.select(this);
    var rect = cell.select("rect");
    var rectX = parseFloat(rect.attr("x")) || 0;
    var rectY = parseFloat(rect.attr("y")) || 0;
    var rectWidth = parseFloat(rect.attr("width")) || 36;
    var rectHeight = parseFloat(rect.attr("height")) || 12;
    var textY = rectY + rectHeight + 14;
    var extent = legendExtents[i] || [minValue, maxValue];
    var leftValue = extent[0];
    var rightValue = extent[1];

    var leftAnchorX = rectX;
    var text = cell.append("text")
      .attr("class", "legend-bound-left")
      .attr("x", leftAnchorX)
      .attr("y", textY)
      .attr("text-anchor", "middle")
      .text(formatValueText(leftValue));

    if (currentMode !== "ranking") {
      var labelRotation = -40;
      var labelOffset = 4;
      text.attr("transform", "rotate(" + labelRotation + " " + (leftAnchorX + labelOffset) + " " + textY + ")");
      text.attr("dx", labelOffset);
    }

    if (i === legendExtents.length - 1) {
      var rightAnchorX = rectX + rectWidth;
      cell.append("text")
        .attr("class", "legend-bound-right")
        .attr("x", rightAnchorX)
        .attr("y", textY)
        .attr("text-anchor", "middle")
        .text(formatValueText(rightValue));
      if (currentMode !== "ranking") {
        var labelRotation = -40;
        var labelOffset = -4;
        cell.select(".legend-bound-right")
          .attr("transform", "rotate(" + labelRotation + " " + (rightAnchorX + labelOffset) + " " + textY + ")")
          .attr("dx", labelOffset);
      }
    }
  });

  var bbox = legendContent.node() && legendContent.node().getBBox ? legendContent.node().getBBox() : null;
  if (!bbox) {
    return;
  }
  var padding = 10;
  legendGroup.insert("rect", ":first-child")
    .attr("class", "legend-background")
    .attr("x", bbox.x - padding)
    .attr("y", bbox.y - padding)
    .attr("width", bbox.width + padding * 2)
    .attr("height", bbox.height + padding * 2)
    .attr("rx", 12)
    .attr("ry", 12)
    .attr("fill", "#ffffff")
    .attr("stroke", "#dfe5ef");

  // 凡例全体を右下から一定距離に配置
  var viewBoxWidth = 800;
  var viewBoxHeight = 800;
  var rightBottomOffset = 20;
  var legendWidth = bbox.width + padding * 2;
  var legendHeight = bbox.height + padding * 2;
  var x = viewBoxWidth - rightBottomOffset - legendWidth;
  var y = viewBoxHeight - rightBottomOffset - legendHeight;
  legendGroup.attr("transform", "translate(" + x + "," + y + ")");
}

function clearLegend() {
  if (legendGroup) {
    legendGroup.selectAll("*").remove();
  }
}

function getLegendExtents(colorScale, fallbackMin, fallbackMax, legendBoundaries) {
  if (legendBoundaries && legendBoundaries.length) {
    var extents = legendBoundaries.map(function (boundary, index) {
      var high = legendBoundaries[index + 1] != null ? legendBoundaries[index + 1] : fallbackMax;
      return [
        boundary != null ? boundary : fallbackMin,
        high
      ];
    });
    if (extents.length) {
      extents[0][0] = extents[0][0] != null ? extents[0][0] : fallbackMin;
      extents[extents.length - 1][1] = fallbackMax;
    }
    return extents;
  }
  if (!colorScale || typeof colorScale.range !== "function") {
    return [];
  }
  var colors = colorScale.range() || [];
  if (!colors.length) {
    return [];
  }
  var extents = colors.map(function (color) {
    var extent = colorScale.invertExtent ? colorScale.invertExtent(color) : null;
    var low = extent && extent[0] != null ? extent[0] : fallbackMin;
    var high = extent && extent[1] != null ? extent[1] : fallbackMax;
    return [low, high];
  });
  if (extents.length) {
    extents[0][0] = extents[0][0] != null ? extents[0][0] : fallbackMin;
    var lastExtent = extents[extents.length - 1];
    if (lastExtent) {
      lastExtent[1] = lastExtent[1] != null ? lastExtent[1] : fallbackMax;
    }
  }
  return extents;
}

function augmentWithRankings(data) {
  if (!data || !data.length) {
    return;
  }
  var numericColumns = getNumericColumns(data);
  if (!numericColumns.length) {
    return;
  }
  numericColumns.forEach(function (column) {
    var entries = data.map(function (row) {
      var value = +row[column];
      return {
        row: row,
        value: isNaN(value) ? null : value
      };
    });

    entries.sort(function (a, b) {
      var aNull = a.value === null;
      var bNull = b.value === null;
      if (aNull && bNull) {
        return 0;
      }
      if (aNull) {
        return 1;
      }
      if (bNull) {
        return -1;
      }
      return b.value - a.value;
    });

    var lastValue = null;
    var rank = 0;
    entries.forEach(function (entry, index) {
      if (entry.value === null) {
        entry.row[getRankingColumnKey(column)] = "";
        return;
      }
      if (index === 0 || entry.value !== lastValue) {
        rank = index + 1;
        lastValue = entry.value;
      }
      entry.row[getRankingColumnKey(column)] = rank;
    });
  });
}
function selectDefaultField(fields, preferredKey, defaultToNone) {
  if (!fields || !fields.length) {
    return null;
  }

  var match = null;
  if (preferredKey) {
    match = fields.find(function (f) {
      return f.key === preferredKey;
    });
  }

  if (match) {
    return match;
  }

  if (defaultToNone) {
    return fields[0];
  }

  var firstNumeric = fields.find(function (f) {
    return f.id !== "none";
  });

  return firstNumeric || fields[0];
}

// Bootstrap
loadMapOptions();
