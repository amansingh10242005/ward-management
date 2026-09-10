const auth = 'Basic ' + Buffer.from('admin:geoserver').toString('base64');

// 1. Fetch feature 36
const getRes = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&featureId=tl_layer_1.36&outputFormat=application/json', { headers: { Authorization: auth } });
const getJson = await getRes.json();
const origGeom = getJson.features[0].geometry;

const coords = origGeom.coordinates;
const polygonMembers = coords.map(polygonCoords => {
  const linearRings = polygonCoords.map(ring => {
    const posList = ring.map(c => `${c[1]} ${c[0]}`).join(' ');
    return `<gml:LinearRing><gml:posList>${posList}</gml:posList></gml:LinearRing>`;
  });
  return `<gml:polygonMember>
    <gml:Polygon srsName="EPSG:4326">
      <gml:exterior>${linearRings[0]}</gml:exterior>
      ${linearRings.slice(1).map(r => `<gml:interior>${r}</gml:interior>`).join('')}
    </gml:Polygon>
  </gml:polygonMember>`;
}).join('');

const gmlString = `<gml:MultiPolygon srsName="EPSG:4326">${polygonMembers}</gml:MultiPolygon>`;

const xml = `
<wfs:Transaction service="WFS" version="1.1.0"
    xmlns:wfs="http://www.opengis.net/wfs"
    xmlns:gml="http://www.opengis.net/gml"
    xmlns:ward="http://ward.local"
    xmlns:ogc="http://www.opengis.net/ogc">
  <wfs:Update typeName="ward:tl_layer_1">
    <wfs:Property>
      <wfs:Name>NAME_ALT</wfs:Name>
      <wfs:Value>TestComb</wfs:Value>
    </wfs:Property>
    <wfs:Property>
      <wfs:Name>geom</wfs:Name>
      <wfs:Value>${gmlString}</wfs:Value>
    </wfs:Property>
    <ogc:Filter>
      <ogc:FeatureId fid="tl_layer_1.36"/>
    </ogc:Filter>
  </wfs:Update>
</wfs:Transaction>`;

const res = await fetch('http://localhost:8080/geoserver/ward/ows', {
  method: 'POST',
  headers: {
    Authorization: auth,
    'Content-Type': 'text/xml'
  },
  body: xml
});
const text = await res.text();
console.log('Status:', res.status);
console.log('Response:\n', text);
