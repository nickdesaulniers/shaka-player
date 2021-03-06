/**
 * Copyright 2014 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @fileoverview Implements a SegmentIndex.
 */

goog.provide('shaka.media.SegmentIndex');

goog.require('shaka.asserts');
goog.require('shaka.media.SegmentRange');
goog.require('shaka.media.SegmentReference');
goog.require('shaka.util.ArrayUtils');



/**
 * Creates a SegmentIndex, which maintains a set of SegmentReferences sorted by
 * their start times.
 *
 * @param {!Array.<!shaka.media.SegmentReference>} references The set of
 *     SegmentReferences, which must be sorted by their start times.
 * @constructor
 * @struct
 */
shaka.media.SegmentIndex = function(references) {
  /** @protected {!Array.<!shaka.media.SegmentReference>} */
  this.references = references;

  /** @protected {number} */
  this.timestampCorrection = 0;
};


/**
 * Destroys this SegmentIndex.
 * @suppress {checkTypes} to set otherwise non-nullable types to null.
 */
shaka.media.SegmentIndex.prototype.destroy = function() {
  this.references = null;
};


/**
 * Gets the number of SegmentReferences.
 *
 * @return {number}
 */
shaka.media.SegmentIndex.prototype.length = function() {
  return this.references.length;
};


/**
 * Gets the first SegmentReference.
 *
 * @return {!shaka.media.SegmentReference} The first SegmentReference.
 * @throws {RangeError} when there are no SegmentReferences.
 */
shaka.media.SegmentIndex.prototype.first = function() {
  if (this.references.length == 0) {
    throw new RangeError('SegmentIndex: There is no first SegmentReference.');
  }
  return this.references[0];
};


/**
 * Gets the last SegmentReference.
 *
 * @return {!shaka.media.SegmentReference} The last SegmentReference.
 * @throws {RangeError} when there are no SegmentReferences.
 */
shaka.media.SegmentIndex.prototype.last = function() {
  if (this.references.length == 0) {
    throw new RangeError('SegmentIndex: There is no last SegmentReference.');
  }
  return this.references[this.references.length - 1];
};


/**
 * Gets the SegmentReference at the given index.
 *
 * @param {number} index
 * @return {!shaka.media.SegmentReference}
 * @throws {RangeError} when |index| is out of range.
 */
shaka.media.SegmentIndex.prototype.get = function(index) {
  if (index < 0 || index >= this.references.length) {
    throw new RangeError('SegmentIndex: The specified index is out of range.');
  }
  return this.references[index];
};


/**
 * Gets the SegmentRange that contains the timestamps |startTime| and
 * |startTime| + |duration|.
 *
 * @param {number} startTime The starting time in seconds.
 * @param {number} duration The interval's duration in seconds.
 * @return {shaka.media.SegmentRange} The SegmentRange, which always contains
 *     at least one SegmentReference, or null if there are no segments.
 */
shaka.media.SegmentIndex.prototype.getRangeForInterval = function(
    startTime, duration) {
  var beginIndex = this.find(startTime);
  if (beginIndex < 0) {
    return null;
  }

  /** @type {!Array.<!shaka.media.SegmentReference>} */
  var references = [];

  for (var i = beginIndex; i < this.references.length; i++) {
    references.push(this.references[i]);
    var endTime = this.references[i].endTime;
    // Note: the end time is exclusive!
    if (!endTime || (endTime > startTime + duration)) {
      break;
    }
  }

  return new shaka.media.SegmentRange(references);
};


/**
 * Gets the index of the SegmentReference for the specified time.
 *
 * @param {number} time The time in seconds.
 * @return {number} The index of the SegmentReference for the specified time.
 *     0 is returned if |time| is less than the first segment's start time. The
 *     index of the last SegmentReference is returned if |time| is greater than
 *     the last segment's start time. -1 is returned if there are no segments.
 */
shaka.media.SegmentIndex.prototype.find = function(time) {
  for (var i = 0; i < this.references.length; i++) {
    if (this.references[i].startTime > time) {
      return i ? i - 1 : 0;
    }
  }

  // |time| is greater than or equal to the last segment's start time or there
  // are no SegmentReferences.
  return this.references.length - 1;
};


/**
 * Integrates |segmentIndex| into this SegmentIndex. Assumes that both
 * SegmentIndexes correspond to the same stream.
 *
 * The default implementation merges |segmentIndex| into this SegmentIndex.
 *
 * @param {!shaka.media.SegmentIndex} segmentIndex
 * @return {boolean} True on success; otherwise, return false.
 */
shaka.media.SegmentIndex.prototype.integrate = function(segmentIndex) {
  this.merge(segmentIndex);
  return true;
};


/**
 * Merges |segmentIndex| into this SegmentIndex, but only if it covers times
 * greater than or equal to times that this SegmentIndex covers.
 *
 * Takes into account timestamp corrections.
 *
 * @param {!shaka.media.SegmentIndex} segmentIndex
 * @protected
 */
shaka.media.SegmentIndex.prototype.merge = function(segmentIndex) {
  if (this.timestampCorrection != segmentIndex.timestampCorrection) {
    var delta = this.timestampCorrection - segmentIndex.timestampCorrection;
    shaka.log.v1(
        'Shifting new SegmentReferences by', delta, 'seconds before merging.');
    segmentIndex = new shaka.media.SegmentIndex(
        shaka.media.SegmentIndex.shift(segmentIndex.references, delta));
  }

  if (this.length() == 0) {
    this.references = segmentIndex.references.slice(0);
    this.assertCorrectReferences();
    return;
  }

  if (segmentIndex.length() == 0) {
    shaka.log.debug('Nothing to merge: new SegmentIndex is empty.');
    return;
  }

  if (this.last().endTime == null) {
    shaka.log.debug(
        'Nothing to merge:',
        'existing SegmentIndex ends at the end of the stream.');
    return;
  }

  if ((segmentIndex.last().endTime != null) &&
      (segmentIndex.last().endTime < this.last().endTime)) {
    shaka.log.debug(
        'Nothing to merge:',
        'new SegmentIndex ends before the existing one ends.');
    return;
  }

  // The new SegmentIndex starts after the existing SegmentIndex.
  if (this.last().endTime <= segmentIndex.first().startTime) {
    // Adjust the last existing segment so that it starts at the the start of
    // the first new segment.
    var adjustedReference = this.last().adjust(
        this.last().startTime, segmentIndex.first().startTime);
    var head = this.references.slice(0, -1).concat([adjustedReference]);
    this.references = head.concat(segmentIndex.references);
    this.assertCorrectReferences();
    return;
  }

  // The new SegmentIndex starts before or in the middle of the existing
  // SegmentIndex.
  var i;
  for (i = 0; i < this.references.length; ++i) {
    if (this.references[i].endTime >= segmentIndex.first().startTime) {
      break;
    }
  }
  shaka.asserts.assert(i < this.references.length);

  var head;
  if (this.references[i].startTime < segmentIndex.first().startTime) {
    // The first new segment starts in the middle of an existing segment, so
    // compress the existing segment such that it ends at the start of the
    // first new segment.
    var adjustedReference = this.references[i].adjust(
        this.references[i].startTime, segmentIndex.first().startTime);
    head = this.references.slice(0, i).concat([adjustedReference]);
  } else {
    // The first new segment either starts before all existing segments or at
    // the start of an existing segment.
    shaka.asserts.assert(
        (this.first().startTime > segmentIndex.first().startTime) ||
        (this.references[i].startTime == segmentIndex.first().startTime));
    head = this.references.slice(0, i);
  }
  this.references = head.concat(segmentIndex.references);
  this.assertCorrectReferences();
};


/**
 * Corrects each SegmentReference's start time and end time with the given
 * timestamp correction, which overrides any previously given timestamp
 * correction.
 *
 * @param {number} timestampCorrection
 */
shaka.media.SegmentIndex.prototype.correct = function(timestampCorrection) {
  var delta = timestampCorrection - this.timestampCorrection;
  this.references = shaka.media.SegmentIndex.shift(this.references, delta);
  this.assertCorrectReferences();
  this.timestampCorrection = timestampCorrection;
  shaka.log.v1('Corrected SegmentIndex by', delta, 'seconds.', this);
};


/**
 * Shifts each SegmentReference in time by |delta| seconds.
 *
 * @param {!Array.<!shaka.media.SegmentReference>} references
 * @param {number} delta
 * @return {!Array.<!shaka.media.SegmentReference>} The shifted
 *     SegmentReferences.
 * @protected
 */
shaka.media.SegmentIndex.shift = function(references, delta) {
  return references.map(
      function(r) {
        return r.adjust(r.startTime + delta,
                        r.endTime != null ? r.endTime + delta : null);
      });
};


/**
 * Assert that the current references meet all requirements.
 *
 * @protected
 */
shaka.media.SegmentIndex.prototype.assertCorrectReferences = function() {
  var previousItem;
  var references = this.references;
  shaka.asserts.assert(
      references.every(function(item, index) {
        var result = true;
        if (index != 0) {
          result = (item.startTime >= previousItem.startTime) &&
                   (item.startTime <= previousItem.endTime) &&
                   ((item.endTime && item.endTime >= previousItem.endTime) ||
                    (index == references.length - 1));
        }
        previousItem = item;
        return result;
      }),
      'SegmentReferences should be sorted without gaps.');
  shaka.asserts.assert(
      shaka.util.ArrayUtils.removeDuplicates(references, function(ref) {
        return ref.id;
      }).length == references.length,
      'SegmentReferences should have unique IDs.');
};

