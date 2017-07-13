/**
* Copyright 2012-2017, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var d3 = require('d3');
var Plotly = require('../plotly');
var Registry = require('../registry');
var Plots = require('../plots/plots');
var Lib = require('../lib');

var Color = require('../components/color');
var Drawing = require('../components/drawing');
var Titles = require('../components/titles');
var ModeBar = require('../components/modebar');
var initInteractions = require('../plots/cartesian/graph_interact');

exports.layoutStyles = function(gd) {
    return Lib.syncOrAsync([Plots.doAutoMargin, exports.lsInner], gd);
};

function overlappingDomain(xDomain, yDomain, domains) {
    for(var i = 0; i < domains.length; i++) {
        var existingX = domains[i][0],
            existingY = domains[i][1];

        if(existingX[0] >= xDomain[1] || existingX[1] <= xDomain[0]) {
            continue;
        }
        if(existingY[0] < yDomain[1] && existingY[1] > yDomain[0]) {
            return true;
        }
    }
    return false;
}

exports.lsInner = function(gd) {
    var fullLayout = gd._fullLayout;
    var gs = fullLayout._size;
    var pad = gs.p;
    var axList = Plotly.Axes.list(gd);
    var hasSVGCartesian = fullLayout._has('cartesian');
    var i;

    // clear axis line positions, to be set in the subplot loop below
    for(i = 0; i < axList.length; i++) axList[i]._linepositions = {};

    fullLayout._paperdiv
        .style({
            width: fullLayout.width + 'px',
            height: fullLayout.height + 'px'
        })
        .selectAll('.main-svg')
            .call(Drawing.setSize, fullLayout.width, fullLayout.height);

    gd._context.setBackground(gd, fullLayout.paper_bgcolor);

    var subplotSelection = fullLayout._paper.selectAll('g.subplot');

    // figure out which backgrounds we need to draw, and in which layers
    // to put them
    var lowerBackgroundIDs = [];
    var lowerDomains = [];
    subplotSelection.each(function(subplot) {
        var plotinfo = fullLayout._plots[subplot];

        if(plotinfo.mainplot) {
            // mainplot is a reference to the main plot this one is overlaid on
            // so if it exists, this is an overlaid plot and we don't need to
            // give it its own background
            if(plotinfo.bg) {
                plotinfo.bg.remove();
            }
            plotinfo.bg = undefined;
            return;
        }

        var xDomain = plotinfo.xaxis.domain;
        var yDomain = plotinfo.yaxis.domain;
        var plotgroupBgData = [];

        if(overlappingDomain(xDomain, yDomain, lowerDomains)) {
            plotgroupBgData = [0];
        }
        else {
            lowerBackgroundIDs.push(subplot);
            lowerDomains.push([xDomain, yDomain]);
        }

        // create the plot group backgrounds now, since
        // they're all independent selections
        var plotgroupBg = plotinfo.plotgroup.selectAll('.bg')
            .data(plotgroupBgData);

        plotgroupBg.enter().append('rect')
            .classed('bg', true);

        plotgroupBg.exit().remove();

        plotgroupBg.each(function() {
            plotinfo.bg = plotgroupBg;
            var pgNode = plotinfo.plotgroup.node();
            pgNode.insertBefore(this, pgNode.childNodes[0]);
        });
    });

    // now create all the lower-layer backgrounds at once now that
    // we have the list of subplots that need them
    var lowerBackgrounds = fullLayout._bgLayer.selectAll('.bg')
        .data(lowerBackgroundIDs);

    lowerBackgrounds.enter().append('rect')
        .classed('bg', true);

    lowerBackgrounds.exit().remove();

    lowerBackgrounds.each(function(subplot) {
        fullLayout._plots[subplot].bg = d3.select(this);
    });

    var freeFinished = {};
    subplotSelection.each(function(subplot) {
        var plotinfo = fullLayout._plots[subplot];
        var xa = plotinfo.xaxis;
        var ya = plotinfo.yaxis;

        // reset scale in case the margins have changed
        xa.setScale();
        ya.setScale();

        if(plotinfo.bg && hasSVGCartesian) {
            plotinfo.bg
                .call(Drawing.setRect,
                    xa._offset - pad, ya._offset - pad,
                    xa._length + 2 * pad, ya._length + 2 * pad)
                .call(Color.fill, fullLayout.plot_bgcolor)
                .style('stroke-width', 0);
        }

        // Clip so that data only shows up on the plot area.
        plotinfo.clipId = 'clip' + fullLayout._uid + subplot + 'plot';

        var plotClip = fullLayout._defs.selectAll('g.clips')
            .selectAll('#' + plotinfo.clipId)
            .data([0]);

        plotClip.enter().append('clipPath')
            .attr({
                'class': 'plotclip',
                'id': plotinfo.clipId
            })
            .append('rect');

        plotClip.selectAll('rect')
            .attr({
                'width': xa._length,
                'height': ya._length
            });


        plotinfo.plot
            .call(Drawing.setTranslate, xa._offset, ya._offset)
            .call(Drawing.setClipUrl, plotinfo.clipId);

        function shouldShowLine(ax, counterAx, side) {
            return (ax.anchor === counterAx._id && (ax.mirror || ax.side === side)) ||
                ax.mirror === 'all' || ax.mirror === 'allticks' ||
                (ax.mirrors && ax.mirrors[counterAx._id + side]);
        }

        var xIsFree = xa.anchor === 'free';
        var showFreeX = xIsFree && !freeFinished[xa._id];
        var showBottom = shouldShowLine(xa, ya, 'bottom');
        var showTop = shouldShowLine(xa, ya, 'top');

        var yIsFree = ya.anchor === 'free';
        var showFreeY = yIsFree && !freeFinished[ya._id];
        var showLeft = shouldShowLine(ya, xa, 'left');
        var showRight = shouldShowLine(ya, xa, 'right');

        var xlw = Drawing.crispRound(gd, xa.linewidth, 1);
        var ylw = Drawing.crispRound(gd, ya.linewidth, 1);

        function findMainAxis(ax) {
            return ax.overlaying ? Plotly.Axes.getFromId(gd, ax.overlaying) : ax;
        }

        function findCounterAxes(ax) {
            var counterAxes = [];
            var anchorAx = Plotly.Axes.getFromId(gd, ax.anchor);
            if(anchorAx) {
                var counterMain = findMainAxis(anchorAx);
                if(counterAxes.indexOf(counterMain) === -1) {
                    counterAxes.push(counterMain);
                }
                for(var i = 0; i < axList.length; i++) {
                    if(axList[i].overlaying === counterMain._id &&
                        counterAxes.indexOf(axList[i]) === -1
                    ) {
                        counterAxes.push(axList[i]);
                    }
                }
            }
            return counterAxes;
        }

        function findLineWidth(axes, side) {
            for(var i = 0; i < axes.length; i++) {
                var ax = axes[i];
                if(ax.anchor !== 'free' && shouldShowLine(ax, {_id: ax.anchor}, side)) {
                    return Drawing.crispRound(gd, ax.linewidth);
                }
            }
        }

        function findCounterAxisLineWidth(ax, subplotCounterLineWidth,
                subplotCounterIsShown, side) {
            if(subplotCounterIsShown) return subplotCounterLineWidth;

            var i;

            // find all counteraxes for this one, then of these, find the
            // first one that has a visible line on this side
            var mainAxis = findMainAxis(ax);
            var counterAxes = findCounterAxes(mainAxis);

            var lineWidth = findLineWidth(counterAxes, side);
            if(lineWidth) return lineWidth;

            for(i = 0; i < axList.length; i++) {
                if(axList[i].overlaying === mainAxis._id) {
                    counterAxes = findCounterAxes(axList[i]);
                    lineWidth = findLineWidth(counterAxes, side);
                    if(lineWidth) return lineWidth;
                }
            }
            return 0;
        }

        /*
         * x lines get longer where they meet y lines, to make a crisp corner
         * free x lines are not excluded - they don't necessarily *meet* the
         * y lines, but it still looks good if the x line reaches to the ends
         * of the y lines, especially in the case of a free axis parallel to
         * an anchored axis, like this:
         *
         *  |
         *  |
         *  +-----
         *    x1
         *  ------
         *  ^ x2
         */
        var xLinesXLeft = -pad - findCounterAxisLineWidth(xa, ylw, showLeft, 'left');
        var xLinesXRight = xa._length + pad + findCounterAxisLineWidth(xa, ylw, showRight, 'right');
        var xLinesYFree = gs.h * (1 - (xa.position || 0)) + ((xlw / 2) % 1);
        var xLinesYBottom = ya._length + pad + xlw / 2;
        var xLinesYTop = -pad - xlw / 2;

        /*
         * y lines do not get longer when they meet x axes, because the
         * x axis already filled that space and we don't want to double-fill.
         * BUT they get longer if they're free axes, for the same reason as
         * we do not exclude x axes:
         *
         *   |   |
         * y2| y1|
         *   |   |
         *  >|   +-----
         *
         * arguably if the free y axis is over top of the anchored x axis,
         * we don't want to do this... but that's a weird edge case, doesn't
         * seem worth adding a lot of complexity for.
         */
        var yLinesYBottom = ya._length + pad + (yIsFree ?
            findCounterAxisLineWidth(ya, xlw, showBottom, 'bottom') :
            0);
        var yLinesYTop = -pad - (yIsFree ?
            findCounterAxisLineWidth(ya, xlw, showTop, 'top') :
            0);
        var yLinesXFree = gs.w * (ya.position || 0) + ((ylw / 2) % 1);
        var yLinesXLeft = -pad - ylw / 2;
        var yLinesXRight = xa._length + pad + ylw / 2;

        function xLinePath(y, showThis) {
            if(!showThis) return '';
            return 'M' + xLinesXLeft + ',' + y + 'H' + xLinesXRight;
        }

        function yLinePath(x, showThis) {
            if(!showThis) return '';
            return 'M' + x + ',' + yLinesYTop + 'V' + yLinesYBottom;
        }

        // save axis line positions for ticks, draggers, etc to reference
        // each subplot gets an entry:
        //    [left or bottom, right or top, free, main]
        // main is the position at which to draw labels and draggers, if any
        xa._linepositions[subplot] = [
            showBottom ? xLinesYBottom : undefined,
            showTop ? xLinesYTop : undefined,
            showFreeX ? xLinesYFree : undefined
        ];
        if(xa.anchor === ya._id) {
            xa._linepositions[subplot][3] = xa.side === 'top' ?
                xLinesYTop : xLinesYBottom;
        }
        else if(showFreeX) {
            xa._linepositions[subplot][3] = xLinesYFree;
        }

        ya._linepositions[subplot] = [
            showLeft ? yLinesXLeft : undefined,
            showRight ? yLinesXRight : undefined,
            showFreeY ? yLinesXFree : undefined
        ];
        if(ya.anchor === xa._id) {
            ya._linepositions[subplot][3] = ya.side === 'right' ?
                yLinesXRight : yLinesXLeft;
        }
        else if(showFreeY) {
            ya._linepositions[subplot][3] = yLinesXFree;
        }

        // translate all the extra stuff to have the
        // same origin as the plot area or axes
        var origin = 'translate(' + xa._offset + ',' + ya._offset + ')';
        var originX = origin;
        var originY = origin;
        if(showFreeX) {
            originX = 'translate(' + xa._offset + ',' + gs.t + ')';
            xLinesYTop += ya._offset - gs.t;
            xLinesYBottom += ya._offset - gs.t;
        }
        if(showFreeY) {
            originY = 'translate(' + gs.l + ',' + ya._offset + ')';
            yLinesXLeft += xa._offset - gs.l;
            yLinesXRight += xa._offset - gs.l;
        }

        if(hasSVGCartesian) {
            plotinfo.xlines
                .attr('transform', originX)
                .attr('d', (
                    xLinePath(xLinesYBottom, showBottom) +
                    xLinePath(xLinesYTop, showTop) +
                    xLinePath(xLinesYFree, showFreeX)) ||
                    // so it doesn't barf with no lines shown
                    'M0,0')
                .style('stroke-width', xlw + 'px')
                .call(Color.stroke, xa.showline ?
                    xa.linecolor : 'rgba(0,0,0,0)');
            plotinfo.ylines
                .attr('transform', originY)
                .attr('d', (
                    yLinePath(yLinesXLeft, showLeft) +
                    yLinePath(yLinesXRight, showRight) +
                    yLinePath(yLinesXFree, showFreeY)) ||
                    'M0,0')
                .style('stroke-width', ylw + 'px')
                .call(Color.stroke, ya.showline ?
                    ya.linecolor : 'rgba(0,0,0,0)');
        }

        plotinfo.xaxislayer.attr('transform', originX);
        plotinfo.yaxislayer.attr('transform', originY);
        plotinfo.gridlayer.attr('transform', origin);
        plotinfo.zerolinelayer.attr('transform', origin);
        plotinfo.draglayer.attr('transform', origin);

        // mark free axes as displayed, so we don't draw them again
        if(showFreeX) freeFinished[xa._id] = 1;
        if(showFreeY) freeFinished[ya._id] = 1;
    });

    Plotly.Axes.makeClipPaths(gd);
    exports.drawMainTitle(gd);
    ModeBar.manage(gd);

    return gd._promises.length && Promise.all(gd._promises);
};

exports.drawMainTitle = function(gd) {
    var fullLayout = gd._fullLayout;

    Titles.draw(gd, 'gtitle', {
        propContainer: fullLayout,
        propName: 'title',
        dfltName: 'Plot',
        attributes: {
            x: fullLayout.width / 2,
            y: fullLayout._size.t / 2,
            'text-anchor': 'middle'
        }
    });
};

// First, see if we need to do arraysToCalcdata
// call it regardless of what change we made, in case
// supplyDefaults brought in an array that was already
// in gd.data but not in gd._fullData previously
exports.doTraceStyle = function(gd) {
    for(var i = 0; i < gd.calcdata.length; i++) {
        var cdi = gd.calcdata[i],
            _module = ((cdi[0] || {}).trace || {})._module || {},
            arraysToCalcdata = _module.arraysToCalcdata;

        if(arraysToCalcdata) arraysToCalcdata(cdi, cdi[0].trace);
    }

    Plots.style(gd);
    Registry.getComponentMethod('legend', 'draw')(gd);

    return Plots.previousPromises(gd);
};

exports.doColorBars = function(gd) {
    for(var i = 0; i < gd.calcdata.length; i++) {
        var cdi0 = gd.calcdata[i][0];

        if((cdi0.t || {}).cb) {
            var trace = cdi0.trace,
                cb = cdi0.t.cb;

            if(Registry.traceIs(trace, 'contour')) {
                cb.line({
                    width: trace.contours.showlines !== false ?
                        trace.line.width : 0,
                    dash: trace.line.dash,
                    color: trace.contours.coloring === 'line' ?
                        cb._opts.line.color : trace.line.color
                });
            }
            if(Registry.traceIs(trace, 'markerColorscale')) {
                cb.options(trace.marker.colorbar)();
            }
            else cb.options(trace.colorbar)();
        }
    }

    return Plots.previousPromises(gd);
};

// force plot() to redo the layout and replot with the modified layout
exports.layoutReplot = function(gd) {
    var layout = gd.layout;
    gd.layout = undefined;
    return Plotly.plot(gd, '', layout);
};

exports.doLegend = function(gd) {
    Registry.getComponentMethod('legend', 'draw')(gd);
    return Plots.previousPromises(gd);
};

exports.doTicksRelayout = function(gd) {
    Plotly.Axes.doTicks(gd, 'redraw');
    exports.drawMainTitle(gd);
    return Plots.previousPromises(gd);
};

exports.doModeBar = function(gd) {
    var fullLayout = gd._fullLayout;
    var subplotIds, subplotObj, i;

    ModeBar.manage(gd);
    initInteractions(gd);

    subplotIds = Plots.getSubplotIds(fullLayout, 'gl3d');
    for(i = 0; i < subplotIds.length; i++) {
        subplotObj = fullLayout[subplotIds[i]]._scene;
        subplotObj.updateFx(fullLayout.dragmode, fullLayout.hovermode);
    }

    subplotIds = Plots.getSubplotIds(fullLayout, 'gl2d');
    for(i = 0; i < subplotIds.length; i++) {
        subplotObj = fullLayout._plots[subplotIds[i]]._scene2d;
        subplotObj.updateFx(fullLayout.dragmode);
    }

    subplotIds = Plots.getSubplotIds(fullLayout, 'mapbox');
    for(i = 0; i < subplotIds.length; i++) {
        subplotObj = fullLayout[subplotIds[i]]._subplot;
        subplotObj.updateFx(fullLayout);
    }

    return Plots.previousPromises(gd);
};

exports.doCamera = function(gd) {
    var fullLayout = gd._fullLayout,
        sceneIds = Plots.getSubplotIds(fullLayout, 'gl3d');

    for(var i = 0; i < sceneIds.length; i++) {
        var sceneLayout = fullLayout[sceneIds[i]],
            scene = sceneLayout._scene;

        scene.setCamera(sceneLayout.camera);
    }
};
