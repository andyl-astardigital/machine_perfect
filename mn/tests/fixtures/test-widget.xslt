<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" indent="yes"/>
  <xsl:template match="/scxml">
    <xsl:apply-templates select="state"/>
  </xsl:template>
  <xsl:template match="state[@id='off']">
    <div class="widget-off">
      <span class="label"><mn-text>label</mn-text></span>
      <span class="count"><mn-text>count</mn-text></span>
      <button mn-to="toggle">Toggle</button>
    </div>
  </xsl:template>
  <xsl:template match="state[@id='on']">
    <div class="widget-on">
      <span class="label"><mn-text>label</mn-text></span>
      <span class="count"><mn-text>count</mn-text></span>
      <button mn-to="toggle">Toggle</button>
    </div>
  </xsl:template>
</xsl:stylesheet>
