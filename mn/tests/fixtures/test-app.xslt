<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" indent="yes"/>
  <xsl:template match="/scxml">
    <div mn="test-app" mn-initial="home">
      <mn-ctx>{"page":"home"}</mn-ctx>
      <div mn-state="home">
        <h1>Home</h1>
        <button mn-to="go-about">Go About</button>
      </div>
      <div mn-state="about">
        <h1>About</h1>
        <button mn-to="go-home">Go Home</button>
      </div>
    </div>
  </xsl:template>
</xsl:stylesheet>
