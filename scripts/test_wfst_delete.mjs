const auth = 'Basic ' + Buffer.from('admin:geoserver').toString('base64');
const xml = `<wfs:Transaction service="WFS" version="1.1.0"
    xmlns:wfs="http://www.opengis.net/wfs"
    xmlns:gml="http://www.opengis.net/gml"
    xmlns:ward="http://ward.local"
    xmlns:ogc="http://www.opengis.net/ogc">
  <wfs:Delete typeName="ward:tl_layer_1">
    <ogc:Filter>
      <ogc:FeatureId fid="tl_layer_1.9999999"/>
    </ogc:Filter>
  </wfs:Delete>
</wfs:Transaction>`;

const res = await fetch('http://localhost:8080/geoserver/ward/ows', {
  method: 'POST',
  headers: { Authorization: auth, 'Content-Type': 'text/xml' },
  body: xml
});
const text = await res.text();
console.log('Status:', res.status);
console.log('Body:', text);
